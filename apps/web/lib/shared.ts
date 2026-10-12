// Browser-safe re-export of @repo/shared. The package's index uses NodeNext-style
// "./x.js" specifiers, which Turbopack can't map back to .ts sources, so the web
// app imports the individual modules directly.
export * from "../../../packages/shared/src/phases";
export * from "../../../packages/shared/src/events";
export * from "../../../packages/shared/src/latency";
export * from "../../../packages/shared/src/clinic";
