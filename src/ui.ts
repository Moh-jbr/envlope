import * as prompts from "@clack/prompts";
import pc from "picocolors";

export const colors = pc;

export function success(message: string): void {
  console.log(`${pc.green("✓")} ${message}`);
}

export function info(message: string): void {
  console.log(`${pc.cyan("›")} ${message}`);
}

export function warn(message: string): void {
  console.log(`${pc.yellow("⚠")} ${message}`);
}

export function fail(message: string): void {
  console.error(`${pc.red("✗")} ${message}`);
}

export function keyBlock(formattedKey: string): void {
  const bar = pc.dim("─".repeat(64));
  console.log("");
  console.log(pc.bold(pc.yellow("SAVE THIS KEY — it cannot be recovered:")));
  console.log(bar);
  console.log(`   ${pc.bold(formattedKey)}`);
  console.log(bar);
  console.log(
    pc.dim(
      "Save it in your password manager and share with teammates over a secure channel.",
    ),
  );
  console.log("");
}

export async function confirm(message: string, defaultValue = false): Promise<boolean> {
  const result = await prompts.confirm({
    message,
    initialValue: defaultValue,
  });

  if (prompts.isCancel(result)) {
    return false;
  }
  return result;
}

export async function promptKey(message = "Enter your envlope key:"): Promise<string> {
  const result = await prompts.password({
    message,
    validate: (value) => {
      if (!value) return "Key is required.";
      if (!value.startsWith("envlope_key_")) return "Key must start with envlope_key_";
      return undefined;
    },
  });

  if (prompts.isCancel(result)) {
    throw new UserCancelled();
  }
  return result;
}

export class UserCancelled extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "UserCancelled";
  }
}

export function nextSteps(steps: string[]): void {
  console.log("");
  console.log(pc.bold("Next:"));
  for (const step of steps) {
    console.log(`  ${pc.dim("$")} ${step}`);
  }
  console.log("");
}
