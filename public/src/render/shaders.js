/**
 * GLSL for the WebGL renderer. Everything is drawn from signed-distance shapes in the fragment shader, so nodes and
 * lines stay crisp at any zoom without extra geometry.
 *
 * Nodes (one quad per node, back to front): a soft drop shadow, the state glow (hover / selection / highlight), the
 * aura (standing states such as owned), a card peeking out behind (collapsed), a ring (Mystic Forge), the body with
 * its icon and patterned border, and a corner badge.
 *
 * Edges (one quad per straight piece): a capsule of constant on-screen width, optionally dashed or dotted, with an
 * optional soft glow, and "flow": bright pulses travelling along highlighted edges.
 *
 * Arrowheads: small constant-size meshes placed at each tip.
 */

export const NODE_VERTEX = `#version 300 es
layout(location=0) in vec2 corner;
layout(location=1) in vec2 center;
layout(location=2) in vec2 halfSize; // "half" is reserved in GLSL ES
layout(location=3) in vec4 fill;
layout(location=4) in vec4 border;
layout(location=5) in vec4 aura;
layout(location=6) in vec4 glow;
layout(location=7) in vec4 ring;
layout(location=8) in vec4 iconRect;
layout(location=9) in vec4 shapeParams;  // border width, shape, pattern, badge
layout(location=10) in vec4 stateParams; // alpha, scale, icon alpha, -
uniform mat3 view;
uniform float pxWorld; // world units per device pixel
out vec2 p;
out vec2 vHalf;
out vec4 vFill;
out vec4 vBorder;
out vec4 vAura;
out vec4 vGlow;
out vec4 vRing;
out vec4 vIcon;
out vec4 vShape;
out vec4 vState;
void main() {
  float scale = stateParams.y;
  // Room around the box for shadow, glow, aura, ring, card and badge, plus anti-aliasing.
  vec2 grown = halfSize + vec2(20.0) + vec2(2.0 * pxWorld / scale);
  p = corner * grown;
  vHalf = halfSize;
  vFill = fill;
  vBorder = border;
  vAura = aura;
  vGlow = glow;
  vRing = ring;
  vIcon = iconRect;
  vShape = shapeParams;
  vState = stateParams;
  vec3 clip = view * vec3(center + p * scale, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}`;

export const NODE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 p;
in vec2 vHalf;
in vec4 vFill;
in vec4 vBorder;
in vec4 vAura;
in vec4 vGlow;
in vec4 vRing;
in vec4 vIcon;
in vec4 vShape;
in vec4 vState;
uniform float pxWorld;
uniform sampler2D icons;
uniform vec4 badgeRect;
out vec4 color;

const float PI = 3.14159265;

float roundBox(vec2 q, vec2 b, float r) {
  vec2 d = abs(q) - b + r;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}
// Regular polygon with n sides, face normals at rotation + (2k+1)·π/n.
float polygon(vec2 q, float n, float apothem, float rotation) {
  float an = PI / n;
  float a = atan(q.y, q.x) + rotation;
  float bn = mod(a, 2.0 * an) - an;
  return length(q) * cos(bn) - apothem;
}
float shapeDistance(vec2 q, vec2 h, float id) {
  float m = min(h.x, h.y);
  if (id < 0.5) return roundBox(q, h, m * 0.06);
  if (id < 1.5) return roundBox(q, h, m * 0.26);
  if (id < 2.5) return roundBox(q, h, m);
  vec2 s = q / h * m;
  float r = m * 0.1;
  if (id < 3.5) return polygon(s, 6.0, m * 0.9 - r, 0.0) - r;
  if (id < 4.5) return polygon(s, 8.0, m - r, PI / 8.0) - r;
  return polygon(s, 4.0, m * 0.74 - r, 0.0) - r;
}
vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }
float fill01(float d, float px) { return clamp(0.5 - d / px, 0.0, 1.0); }

void main() {
  float scale = vState.y;
  float px = pxWorld / scale; // one device pixel, in node units
  vec2 h = vHalf;
  float id = vShape.y;
  float pattern = vShape.z;
  float d = shapeDistance(p, h, id);
  float bw = max(vShape.x, px);
  vec4 result = vec4(0.0);

  // Drop shadow: the node floats a little above the canvas.
  float shadowD = shapeDistance(p - vec2(0.0, 2.5), h, id);
  float shadow = 0.32 * (1.0 - smoothstep(-2.0, 8.0, shadowD));
  result = over(vec4(0.0, 0.0, 0.0, shadow), result);

  // State glow (hover, selection, highlight).
  if (vGlow.a > 0.001) {
    float g = vGlow.a * exp(-max(d, 0.0) / 7.0);
    result = over(vec4(vGlow.rgb * g, g), result);
  }
  // Aura: a standing state, softer and closer.
  if (vAura.a > 0.001) {
    float a = vAura.a * 0.6 * (1.0 - smoothstep(0.0, 12.0, d));
    result = over(vec4(vAura.rgb * a, a), result);
  }
  // Collapsed: a second card peeks out behind, up and to the right.
  if (pattern > 2.5) {
    float cardD = shapeDistance(p - vec2(5.0, -5.0), h, id);
    float card = fill01(cardD, px);
    float cardEdge = fill01(-(cardD + bw * 0.7), px);
    vec3 cardColor = mix(vBorder.rgb, vFill.rgb * 0.8 + vBorder.rgb * 0.2, cardEdge);
    result = over(vec4(cardColor * card, card), result);
  }
  // Ring just outside the border.
  if (vRing.a > 0.001) {
    float ringD = abs(d - 4.5) - 1.4;
    float r = vRing.a * fill01(ringD, px);
    result = over(vec4(vRing.rgb * r, r), result);
  }

  // Body: fill, icon, then the border band.
  float inside = fill01(d, px);
  if (inside > 0.0) {
    vec4 body = vec4(vFill.rgb * vFill.a, vFill.a);
    if (vIcon.z > 0.0 && vState.z > 0.0) {
      vec2 inner = h - vec2(bw + 2.0);
      vec2 uv = p / max(inner, vec2(0.001)) * 0.5 + 0.5;
      if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
        vec4 texel = texture(icons, mix(vIcon.xy, vIcon.zw, uv)) * vState.z; // premultiplied
        body = over(texel, body);
      }
    }
    float onBorder = clamp((d + bw) / px + 0.5, 0.0, 1.0);
    if (pattern > 0.5 && pattern < 2.5) {
      // Dashes and dots run around the outline.
      float along = (atan(p.y, p.x) + PI) * (h.x + h.y) * 0.5;
      float period = pattern < 1.5 ? 9.0 : 5.0;
      float on = pattern < 1.5 ? 5.5 : 2.2;
      float phase = mod(along, period);
      onBorder *= clamp((on - phase) / px + 0.5, 0.0, 1.0) * clamp(phase / px + 0.5, 0.0, 1.0);
    }
    body = mix(body, vec4(vBorder.rgb, 1.0), onBorder);
    result = over(body * inside, result);
  }

  // Corner badge (Mystic Forge), top right, half on the border.
  if (vShape.w > 0.5 && badgeRect.z > 0.0) {
    float radius = min(h.x, h.y) * 0.42;
    vec2 uv = (p - vec2(h.x * 0.66, -h.y * 0.66)) / (2.0 * radius) + 0.5;
    if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0))))
      result = over(texture(icons, mix(badgeRect.xy, badgeRect.zw, uv)), result);
  }

  color = result * vState.x;
  if (color.a < 0.002) discard;
}`;

export const EDGE_VERTEX = `#version 300 es
layout(location=0) in vec2 corner; // x: along (0..1), y: across (-1..1)
layout(location=1) in vec2 from;
layout(location=2) in vec2 to;
layout(location=3) in vec4 lineColor;
layout(location=4) in vec4 lineParams;  // width (css px), distance to the piece start (world), pattern, flow
layout(location=5) in vec4 extraParams; // trim start (css px), trim end (css px), glow, -
uniform mat3 view;
uniform vec2 viewport;    // device pixels
uniform float zoomPx;     // device pixels per world unit
uniform float pixelScale; // device pixels per css pixel
out vec4 vColor;
out vec2 local;       // (along, across) in device pixels from the piece start
out float vLength;
out float vHalfWidth;
out float vStart;     // device pixels along the whole edge where this piece starts
out float vPattern;
out float vFlow;
out float vGlow;
void main() {
  vec2 a = (view * vec3(from, 1.0)).xy * viewport * 0.5;
  vec2 b = (view * vec3(to, 1.0)).xy * viewport * 0.5;
  vec2 direction = b - a;
  float fullLength = max(length(direction), 0.0001);
  vec2 unit = direction / fullLength;
  float trimStart = min(extraParams.x * pixelScale, fullLength * 0.45);
  float trimEnd = min(extraParams.y * pixelScale, fullLength * 0.45);
  a += unit * trimStart;
  b -= unit * trimEnd;
  float segmentLength = max(length(b - a), 0.0001);
  vec2 normal = vec2(-unit.y, unit.x);
  float halfWidth = lineParams.x * pixelScale * 0.5;
  float margin = halfWidth + 1.5 + (extraParams.z > 0.0 || lineParams.w != 0.0 ? 7.0 * pixelScale : 0.0);
  float along = mix(-margin, segmentLength + margin, corner.x);
  float across = corner.y * margin;
  vec2 position = a + unit * along + normal * across;
  gl_Position = vec4(position / (viewport * 0.5), 0.0, 1.0);
  vColor = lineColor;
  local = vec2(along, across);
  vLength = segmentLength;
  vHalfWidth = halfWidth;
  vStart = lineParams.y * zoomPx + trimStart;
  vPattern = lineParams.z;
  vFlow = lineParams.w;
  vGlow = extraParams.z;
}`;

export const EDGE_FRAGMENT = `#version 300 es
precision highp float;
in vec4 vColor;
in vec2 local;
in float vLength;
in float vHalfWidth;
in float vStart;
in float vPattern;
in float vFlow;
in float vGlow;
uniform float time;       // seconds
uniform float pixelScale;
uniform float flowSpeed;
out vec4 color;
void main() {
  float along = clamp(local.x, 0.0, vLength);
  float d = length(vec2(local.x - along, local.y)) - vHalfWidth; // capsule: round ends and joins
  float line = clamp(0.5 - d, 0.0, 1.0);
  float position = vStart + local.x;
  if (vPattern > 0.5) {
    if (vPattern < 1.5) {
      float period = 11.0 * pixelScale, on = 6.5 * pixelScale;
      float phase = mod(position, period);
      line *= clamp(on - phase + 0.5, 0.0, 1.0) * clamp(phase + 0.5, 0.0, 1.0);
    } else {
      float period = 6.5 * pixelScale;
      float offset = mod(position, period) - period * 0.5;
      float radius = max(vHalfWidth, 1.1 * pixelScale);
      line = clamp(0.5 - (length(vec2(offset, local.y)) - radius), 0.0, 1.0);
    }
  }
  vec3 rgb = vColor.rgb;
  float alpha = line;
  if (vGlow > 0.0) {
    float halo = vGlow * 0.4 * exp(-max(d, 0.0) / (3.5 * pixelScale));
    alpha = max(alpha, halo);
  }
  if (vFlow != 0.0) {
    // Pulses: a bright head with a fading tail, travelling toward the target (flow > 0) or the source (flow < 0).
    float spacing = 48.0 * pixelScale;
    float phase = mod(sign(vFlow) * position - time * 70.0 * pixelScale * flowSpeed, spacing) / spacing;
    float pulse = pow(phase, 6.0) * smoothstep(1.0, 0.94, phase);
    float head = clamp(0.5 - (d - pulse * 1.6 * pixelScale), 0.0, 1.0);
    float halo = pulse * 0.55 * exp(-max(d, 0.0) / (3.0 * pixelScale));
    rgb = mix(rgb, vec3(1.0), pulse * 0.75);
    alpha = max(max(alpha, head * pulse), halo);
  }
  alpha *= vColor.a;
  if (alpha < 0.002) discard;
  color = vec4(rgb * alpha, alpha);
}`;

export const ARROW_VERTEX = `#version 300 es
layout(location=0) in vec2 shapePoint; // (back, side) in arrow sizes
layout(location=1) in vec2 tip;
layout(location=2) in vec2 direction; // world, pointing at the tip
layout(location=3) in vec4 arrowColor;
layout(location=4) in float sizePx; // css px
uniform mat3 view;
uniform vec2 viewport;
uniform float pixelScale;
out vec4 vColor;
void main() {
  vec2 clip = (view * vec3(tip, 1.0)).xy;
  vec2 unit = normalize(direction + vec2(1e-6, 0.0));
  vec2 side = vec2(-unit.y, unit.x);
  vec2 offset = (-unit * shapePoint.x - side * shapePoint.y) * sizePx * pixelScale; // device px, y down
  gl_Position = vec4(clip + vec2(offset.x, -offset.y) / (viewport * 0.5), 0.0, 1.0);
  vColor = arrowColor;
}`;

export const ARROW_FRAGMENT = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 color;
void main() { color = vec4(vColor.rgb * vColor.a, vColor.a); }`;
