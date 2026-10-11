<!--
  The Characters page: connect an account → character list → one character's armory (`#<name>`). The account comes
  from the shared AccountSession (the header's account control connects, refreshes and forgets). The list and armory
  markup still comes from the tested builders in character-view.js; this component decides what to show and handles
  the view choices (build tab, weapon set, gear view), keeping focus and scroll when it redraws in place.
-->
<script>
  /* eslint-disable svelte/prefer-svelte-reactivity -- the Maps here are replaced whole ($state.raw), never changed in
     place. */
  import { tick, untrack } from "svelte";
  import { activeBuild, buildArmory } from "../model/character-armory.js";
  import { escapeHtml } from "../utils/dom.js";
  import { reactiveAccount } from "./account.svelte.js";
  import {
    armoryHtml,
    characterListHtml,
    MISSING_BUILDS_NOTICE,
  } from "./character-view.js";
  import { gearTips } from "./gear-tips.js";
  import { openShareDialog } from "./share-image.js";

  /**
   * @type {{ session: import('../data/account-session.js').AccountSession,
   *          catalogs: import('../data/account-client.js').CharacterCatalogs }}
   */
  let { session, catalogs } = $props();

  const account = $derived(reactiveAccount(session));

  /** The character named in the URL (`#<name>`), or "" for the list. */
  let characterName = $state(readHash());
  /** Icons or Full: a per-viewer preference, remembered in this browser. */
  let gearView = $state(readGearView());
  /** Per-character view choices ({ tab, weaponSet }), kept while the page is open, for the account shown. */
  let choices = $state.raw(new Map());
  let choicesAccount = null;

  /** What the content area shows. */
  let content = $state.raw({ html: "", tooltips: new Map() });
  /** Loading and error messages for screen readers; the content area itself isn't a live region. */
  let announcement = $state("");

  let apiKey = $state("");
  let rememberKey = $state(false);

  /** @type {HTMLElement} */ let contentElement;
  /** The armory drawn now (for Share), and what was last drawn (for redrawing in place). */
  let armory = null;
  let shown = "";
  let renderToken = 0;

  const view = $derived.by(() => {
    const { status } = account.current;
    if (status === "ready") return "ready";
    if (status === "connecting") return "connecting";
    return "key";
  });

  // Decide what to show whenever the account, the URL or a view choice changes.
  $effect(() => {
    const current = account.current,
      name = characterName,
      gear = gearView,
      choice = choices.get(characterName);
    untrack(() => show(current, name, gear, choice)); // what show() reads or writes isn't a dependency
  });

  /** Any change of view: an armory still loading must not draw over what replaced it. */
  function invalidate() {
    return ++renderToken;
  }

  function setContent(html, tooltips = new Map()) {
    content = { html, tooltips };
  }

  function message(html) {
    invalidate();
    shown = "";
    setContent(`<p class="notice">${html}</p>`);
    announcement = htmlText(html);
  }

  function show(current, name, gear, choice) {
    const { status, accountName, characters, charactersUnavailable } = current;
    if (status === "connecting") {
      invalidate();
      shown = "";
      setContent('<p class="loading">Connecting to your account…</p>');
      announcement = "Connecting to your account…";
      return;
    }
    if (status !== "ready") {
      // The key form. A rejected key stays in the form so a typo can be fixed; otherwise it's cleared.
      invalidate();
      shown = "";
      if (choices.size) choices = new Map();
      choicesAccount = null;
      if (status !== "error") apiKey = "";
      setContent("");
      announcement = "";
      return;
    }
    apiKey = ""; // connected: the key mustn't linger in the form
    if (accountName !== choicesAccount) {
      choicesAccount = accountName;
      if (choices.size) choices = new Map();
    }
    if (charactersUnavailable) {
      message(
        "Your characters couldn't be loaded: the GW2 API didn't answer. <button type=\"button\" data-retry>Try again</button>",
      );
      return;
    }
    if (!characters) {
      message(
        "This API key doesn't have the <b>characters</b> permission. Use the account menu at the top right to connect a key with <b>characters</b> and <b>builds</b>.",
      );
      return;
    }
    const character = name
      ? characters.find((candidate) => candidate.name === name)
      : null;
    if (character) renderArmory(current, character, gear, choice ?? {});
    else renderList(current);
  }

  async function renderList(current) {
    const token = invalidate();
    shown = "";
    await catalogs.loadSpecializations(); // elite spec names and icons; loaded once
    if (token !== renderToken) return;
    const summaries = current.characters.map((character) => ({
      ...character,
      build: activeBuild(character, catalogs.specializations),
    }));
    const notice = current.hasBuilds ? "" : MISSING_BUILDS_NOTICE;
    setContent(notice + characterListHtml(summaries, current.accountName));
    announcement = "";
  }

  async function renderArmory(current, character, gear, choice) {
    const token = invalidate();
    // The same character again (a view choice or fresh data): redraw in place, keeping focus and scroll.
    const key = `${current.accountName}|${character.name}`;
    const inPlace = shown === key;
    const restore = inPlace ? captureFocus() : null;
    if (!inPlace) {
      const loading = `Loading ${character.name}'s gear…`;
      setContent(`<p class="loading">${escapeHtml(loading)}</p>`);
      announcement = loading;
    }
    try {
      await catalogs.loadFor(character);
      if (token !== renderToken) return; // the user moved on while this loaded
      armory = buildArmory(character, catalogs, choice.tab ?? null);
      const drawn = armoryHtml(armory, choice.weaponSet ?? armory.defaultSet, {
        view: gear,
        // Without `builds` there's no equipment to show: say so instead of drawing empty slots and base stats.
        hasGear: current.hasBuilds,
      });
      shown = key;
      setContent(drawn.html, drawn.tooltips);
      announcement = "";
      if (restore) {
        await tick();
        restore();
      }
    } catch (error) {
      if (token === renderToken) {
        shown = "";
        const text = `Couldn't show ${character.name}'s gear: ${error.message}`;
        setContent(`<p class="empty">${escapeHtml(text)}</p>`);
        announcement = text;
      }
    }
  }

  /** A view choice for the character shown. */
  function choose(change) {
    const next = new Map(choices);
    next.set(characterName, {
      ...choices.get(characterName),
      tab: armory?.tab,
      ...change,
    });
    choices = next;
  }

  /** Clicks on the drawn markup: view choices, Share, Try again. */
  function onContentClick(event) {
    const target = event.target.closest?.(
      "[data-tab], [data-weapon-set], [data-gear-view], [data-share-open], [data-retry]",
    );
    if (!target) return;
    const data = target.dataset;
    if (data.retry != null) session.refresh();
    else if (data.shareOpen != null && armory)
      openShareDialog(armory, gearView === "full" ? "full" : "compact");
    else if (data.gearView) {
      gearView = data.gearView;
      saveGearView(gearView);
    } else if (data.weaponSet) choose({ weaponSet: data.weaponSet });
    else if (data.tab) choose({ tab: Number(data.tab) });
  }

  /**
   * Remembers the focused view control (by its data-tab / data-weapon-set / data-gear-view value and position) and
   * the scroll position; the returned function restores both once the armory has been redrawn.
   */
  function captureFocus() {
    const { scrollX, scrollY } = window;
    const active = document.activeElement;
    const attribute = ["data-tab", "data-weapon-set", "data-gear-view"].find(
      (name) => contentElement.contains(active) && active.hasAttribute(name),
    );
    let selector = null,
      index = -1;
    if (attribute) {
      selector = `[${attribute}="${CSS.escape(active.getAttribute(attribute))}"]`;
      // Set 1/2 and the weapon-set titles share a value: the position tells them apart.
      index = [...contentElement.querySelectorAll(selector)].indexOf(active);
    }
    return () => {
      const control =
        selector && contentElement.querySelectorAll(selector)[index];
      control?.focus({ preventScroll: true });
      window.scrollTo(scrollX, scrollY);
    };
  }

  function connect(event) {
    event.preventDefault();
    session.connect(apiKey, { remember: rememberKey });
  }

  function readHash() {
    try {
      return decodeURIComponent(location.hash.slice(1));
    } catch {
      return ""; // malformed hash: show the list
    }
  }

  function htmlText(html) {
    const element = document.createElement("div");
    element.innerHTML = html;
    return element.textContent;
  }

  const GEAR_VIEW_KEY = "gw2ct.gearView";

  function readGearView() {
    try {
      return localStorage.getItem(GEAR_VIEW_KEY) === "full" ? "full" : "icons";
    } catch {
      return "icons"; // storage blocked
    }
  }

  function saveGearView(value) {
    try {
      localStorage.setItem(GEAR_VIEW_KEY, value);
    } catch {
      /* private mode: kept for this page only */
    }
  }
</script>

<svelte:window onhashchange={() => (characterName = readHash())} />

<section class="key-panel" id="keyPanel" hidden={view !== "key"}>
  <h2>Connect your Guild Wars 2 account</h2>
  <p>
    Paste an API key to see your characters' gear. Create one at
    <a
      href="https://account.arena.net/applications"
      target="_blank"
      rel="noopener noreferrer">account.arena.net/applications</a
    >
    with the <b>characters</b> and <b>builds</b> permissions (add
    <b>inventories</b> and <b>wallet</b> to use what you own on the crafting page
    too).
  </p>
  <form class="key-form" autocomplete="off" onsubmit={connect}>
    <label for="apiKey" class="sr-only">API key</label>
    <input
      id="apiKey"
      type="password"
      spellcheck="false"
      placeholder="XXXXXXXX-XXXX-…"
      autocomplete="off"
      bind:value={apiKey}
    />
    <label class="remember"
      ><input type="checkbox" bind:checked={rememberKey} /> Remember in this browser</label
    >
    <button type="submit" class="primary">Connect</button>
  </form>
  <p class="key-error" role="alert">
    {view === "key" && account.current.status === "error"
      ? account.current.error
      : ""}
  </p>
  <p class="muted small">
    The key stays in this browser and is sent only to the official API at
    api.guildwars2.com; this site has no server that could store it. API keys
    are read-only and can be revoked at any time on the same page.
  </p>
</section>

<p id="characterStatus" class="sr-only" role="status">{announcement}</p>
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (clicks come from the buttons inside) -->
<div
  id="characterContent"
  bind:this={contentElement}
  use:gearTips={content.tooltips}
  onclick={onContentClick}
>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- markup from character-view.js, which escapes all API text -->
  {@html content.html}
</div>
