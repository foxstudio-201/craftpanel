/* Frontend mirror of the backend service-type registry. Fetched once from
   /servers/meta/registry and cached; drives the per-service sidebar, tab gating
   and the creation wizards. */
(function () {
  let cache = null;

  async function load() {
    if (cache) return cache;
    cache = await api.get('/servers/meta/registry'); // { types: [...], pageMeta }
    cache.byKey = Object.fromEntries(cache.types.map((t) => [t.key, t]));
    return cache;
  }

  /** The serviceType of a server record (Minecraft records predate serviceType). */
  function typeOf(server) {
    const t = server?.serviceType;
    return cache?.byKey?.[t] ? t : 'minecraft';
  }

  const def = (type) => cache?.byKey?.[type] || cache?.byKey?.minecraft;
  const pagesFor = (type) => def(type)?.pages || [];
  const feature = (type, name) => Boolean(def(type)?.features?.[name]);
  const featureValue = (type, name) => def(type)?.features?.[name] ?? null;
  const labelFor = (type) => def(type)?.label || type;
  const iconFor = (type) => def(type)?.icon || 'box';
  const versionsFor = (type) => def(type)?.versions || [];
  const templatesFor = (type) => def(type)?.templates || [];
  const pageMeta = (key) => cache?.pageMeta?.[key] || null;

  window.ServiceRegistry = { load, typeOf, def, pagesFor, feature, featureValue, labelFor, iconFor, versionsFor, templatesFor, pageMeta, get raw() { return cache; } };
})();
