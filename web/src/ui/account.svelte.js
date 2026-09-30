/**
 * The shared AccountSession as Svelte state: components read `account.current.status`, `.characters`… and update
 * when the session announces a change. The session stays the source of truth: call its methods (connect, refresh…)
 * to act. Each change replaces the snapshot ($state.raw), so the character data is never made deeply reactive.
 * @param {import('../data/account-session.js').AccountSession} session
 * @returns {{ readonly current: ReturnType<typeof snapshot> }}
 */
export function reactiveAccount(session) {
  let current = $state.raw(snapshot(session));
  // A background refresh starting (or failing quietly) changes nothing shown: only new data or a new status counts.
  const signature = ({ status, accountName, fetchedAt, error, characters }) =>
    [status, accountName, fetchedAt, error, characters ? 1 : 0].join("|");
  session.addEventListener("change", () => {
    const next = snapshot(session);
    if (signature(next) !== signature(current)) current = next;
  });
  return {
    get current() {
      return current;
    },
  };
}

/** @param {import('../data/account-session.js').AccountSession} session */
function snapshot(session) {
  return {
    status: session.status,
    error: session.error,
    accountName: session.accountName,
    fetchedAt: session.fetchedAt,
    /** @type {object[] | null} raw /v2/characters entries */
    characters: session.characters,
    charactersUnavailable: session.charactersUnavailable,
    hasBuilds: session.has("builds"),
  };
}
