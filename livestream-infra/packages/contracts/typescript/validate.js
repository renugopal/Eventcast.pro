// Plain Node.js (deliberately not TypeScript) validation harness that
// proves contracts.ts matches ../contracts.json, the language-neutral
// source of truth. Kept as plain JavaScript so it runs with only the
// Node.js runtime plus the compiled dist/contracts.js output, without
// requiring @types/node or any other ambient TypeScript types.
//
// Run:
//   1. Compile: tsc -p packages/contracts/typescript/tsconfig.json
//   2. Validate: node packages/contracts/typescript/validate.js
"use strict";

const fs = require("fs");
const path = require("path");

const contracts = require("./dist/contracts.js");

const contractsJsonPath = path.resolve(__dirname, "..", "contracts.json");
const parsed = JSON.parse(fs.readFileSync(contractsJsonPath, "utf8"));

const failures = [];

function assertEqual(name, got, want) {
  if (got !== want) {
    failures.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

function assertSetsEqual(name, got, want) {
  const gotSorted = [...got].sort();
  const wantSorted = [...want].sort();
  const equal = gotSorted.length === wantSorted.length && gotSorted.every((v, i) => v === wantSorted[i]);
  if (!equal) {
    failures.push(`${name} mismatch:\n    ts:   ${JSON.stringify(gotSorted)}\n    json: ${JSON.stringify(wantSorted)}`);
  }
}

assertEqual("SCHEMA_VERSION", contracts.SCHEMA_VERSION, parsed.schemaVersion);

const jsonEnvelopeFieldNames = parsed.srsCallbacks.envelopeFields.map((f) => f.jsonName);
const tsEnvelopeFieldNames = [
  "action", "client_id", "ip", "vhost", "app", "stream",
  "param", "file", "url", "m3u8", "duration", "seq_no",
];
assertSetsEqual(
  "SrsCallbackPayload fields vs contracts.json envelopeFields",
  tsEnvelopeFieldNames,
  jsonEnvelopeFieldNames
);

assertSetsEqual("ERROR_CODES", contracts.ERROR_CODES, parsed.errorCodes.values);
assertSetsEqual("MEDIA_NODE_STATES", contracts.MEDIA_NODE_STATES, parsed.mediaNodeStates.values);
assertSetsEqual("EVENT_MEDIA_STATES", contracts.EVENT_MEDIA_STATES, parsed.eventMediaStates.values);
assertSetsEqual("STREAM_SESSION_STATES", contracts.STREAM_SESSION_STATES, parsed.streamSessionStates.values);
assertSetsEqual("MEDIA_JOB_STATES", contracts.MEDIA_JOB_STATES, parsed.mediaJobStates.values);
assertSetsEqual("MEDIA_JOB_TYPES", contracts.MEDIA_JOB_TYPES, parsed.mediaJobTypes.values);

assertEqual(
  "SRS_ROUTES.onPublish",
  contracts.SRS_ROUTES.onPublish,
  parsed.srsCallbacks.actions.on_publish.route.split(" ")[1]
);
assertEqual(
  "SRS_ROUTES.onHls",
  contracts.SRS_ROUTES.onHls,
  parsed.srsCallbacks.actions.on_hls.route.split(" ")[1]
);
assertEqual(
  "SRS_ROUTES.onUnpublish",
  contracts.SRS_ROUTES.onUnpublish,
  parsed.srsCallbacks.actions.on_unpublish.route.split(" ")[1]
);

if (failures.length > 0) {
  console.error("Contract validation FAILED:");
  for (const f of failures) {
    console.error(`  - ${f}`);
  }
  process.exit(1);
}

console.log("Contract validation PASSED: TypeScript representations match contracts.json.");
