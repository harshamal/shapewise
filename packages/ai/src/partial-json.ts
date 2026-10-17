/**
 * Best effort parse of JSON that is still arriving, for showing a streamed
 * structured answer as it is written. Closes the open string and containers
 * and drops a trailing half written token. Returns undefined when nothing
 * usable can be read yet. The final answer is always parsed and validated
 * normally; this is only for display.
 */
export function parsePartialJson(text: string): unknown {
  let s = text.trimStart();
  if (!s) return undefined;
  for (let tries = 0; tries < 4 && s; tries++) {
    const closed = close(s);
    if (closed !== undefined) {
      try {
        return JSON.parse(closed);
      } catch {
        /* fall through and cut back */
      }
    }
    s = cutBack(s);
  }
  return undefined;
}

function scan(s: string) {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }
  return { stack, inStr, esc };
}

function close(s: string): string | undefined {
  const { stack, inStr, esc } = scan(s);
  let t = s;
  if (inStr) {
    if (esc) t = t.slice(0, -1);
    t = t.replace(/\\u[0-9a-fA-F]{0,3}$/, "");
    // A string that is an object key with no value yet can't be shown.
    t += '"';
    if (stack.at(-1) === "{" && /[{,]\s*"(?:[^"\\]|\\.)*"$/.test(t)) t += ":null";
  } else {
    t = t.replace(/[\s,]+$/, "");
    if (/:\s*$/.test(t)) t += "null";
    else if (stack.at(-1) === "{" && /[{,]\s*"(?:[^"\\]|\\.)*"$/.test(t)) t += ":null";
  }
  return t + stack.reverse().map((c) => (c === "{" ? "}" : "]")).join("");
}

/** Drop back to before the last value separator outside a string. */
function cutBack(s: string): string {
  let inStr = false;
  let esc = false;
  let cut = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "," || ch === "{" || ch === "[") cut = i;
  }
  if (cut < 0) return "";
  return s[cut] === "," ? s.slice(0, cut) : s.slice(0, cut + 1);
}
