import manifest from "../manifest.json";

interface ContentScriptEntry {
  exclude_matches?: string[];
  js: string[];
}

const BRIDGE_PAGE_EXCLUSIONS = [
  "http://127.0.0.1/bridge*",
  "http://localhost/bridge*",
];

const TARGET_PAGE_SCRIPTS = [
  "public/generated/network_capture_main.js",
  "src/content/main.ts",
];

function main(): void {
  const contentScripts = manifest.content_scripts as ContentScriptEntry[];
  TARGET_PAGE_SCRIPTS.forEach((scriptPath) => {
    runTest(`${scriptPath} excludes local bridge pages`, () => {
      const entry = contentScripts.find((candidate) => candidate.js.includes(scriptPath));
      assert(entry, `missing content script entry for ${scriptPath}`);
      assertEqual(
        JSON.stringify(entry.exclude_matches),
        JSON.stringify(BRIDGE_PAGE_EXCLUSIONS),
        `${scriptPath} bridge exclusions changed`
      );
    });
  });
}

function runTest(name: string, test: () => void): void {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

main();
