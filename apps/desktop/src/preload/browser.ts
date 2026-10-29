// Preload injected into the user's page inside the browser panel (Stage 1). It runs in an
// isolated world, exposes nothing to the page and will talk to main over the private
// `arbora:page:` channel prefix. Intentionally empty in Stage 0.
export {};
