// The e2e server writes its emails here (MAIL_BACKEND=file, see playwright.config.ts), so tests
// can open the links in them like a person would.
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "@playwright/test";

export const OUTBOX_DIR = join(tmpdir(), "studyflow-e2e-outbox");

/** Long lines in emails are sent quoted-printable ("=" soft line breaks, "=3D" for "="). */
function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function messagesTo(address: string): string[] {
  const header = `to: ${address}`.toLowerCase();
  try {
    return readdirSync(OUTBOX_DIR)
      .filter((f) => f.endsWith(".eml"))
      .map((f) => decodeQuotedPrintable(readFileSync(join(OUTBOX_DIR, f), "utf8")))
      .filter((m) => m.split(/\r?\n/).some((line) => line.trim().toLowerCase() === header));
  } catch {
    return []; // nothing sent yet: the folder doesn't exist
  }
}

/** Wait for an email to `address` and return the link in it. */
export async function linkEmailedTo(address: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(() => {
      link = messagesTo(address)
        .map((m) => /https?:\/\/\S+#token=[A-Za-z0-9_-]+/.exec(m)?.[0])
        .find(Boolean);
      return link;
    })
    .toBeTruthy();
  return link!;
}
