import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelInfo, ProviderInfo, ProviderModuleDescriptor, StoredProvider } from "@shared/types";
import { Icon } from "@renderer/components/Icon";
import { useAppStore } from "@renderer/state/appStore";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { toast } from "@renderer/state/toastStore";

const ID_RE = /^[a-zA-Z0-9._-]+$/;

function statusLabel(provider: ProviderInfo): string {
  if (provider.kind === "local") return provider.running ? "local · running" : "local · offline";
  return provider.configured ? "cloud" : "no key";
}

function localModules(modules: ProviderModuleDescriptor[]): ProviderModuleDescriptor[] {
  return modules.filter((module) => module.id === "ollama" || module.id === "openai-compatible");
}

function AddLocalEndpointForm({
  modules,
  existingIds,
  onAdded,
  onCancel
}: {
  modules: ProviderModuleDescriptor[];
  existingIds: Set<string>;
  onAdded: () => Promise<void>;
  onCancel: () => void;
}) {
  const patch = useSettingsStore((state) => state.patch);
  const options = useMemo(() => localModules(modules), [modules]);
  const [moduleId, setModuleId] = useState(options[0]?.id ?? "openai-compatible");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const module = options.find((entry) => entry.id === moduleId);
    if (module) setBaseUrl(module.defaultBaseUrl);
  }, [moduleId, options]);

  const submit = async (): Promise<void> => {
    const module = options.find((entry) => entry.id === moduleId);
    const trimmedName = name.trim();
    const trimmedBase = baseUrl.trim();
    const id = trimmedName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
    if (!module) return setError("Choose a module.");
    if (!trimmedName) return setError("Give the endpoint a name.");
    if (!ID_RE.test(id)) return setError("Use letters, numbers, dot, dash, or underscore.");
    if (existingIds.has(id)) return setError("A provider with that id already exists.");
    if (!/^https?:\/\//i.test(trimmedBase)) return setError("Base URL must start with http:// or https://");

    const provider: StoredProvider = {
      id,
      name: trimmedName,
      moduleId: module.id,
      kind: "local",
      baseUrl: trimmedBase,
      needsSecret: false
    };
    setBusy(true);
    try {
      const current = useSettingsStore.getState().settings?.providers ?? [];
      const hidden = (useSettingsStore.getState().settings?.hiddenProviders ?? []).filter((entry) => entry !== id);
      await patch({ providers: [...current.filter((entry) => entry.id !== id), provider], hiddenProviders: hidden });
      await onAdded();
      toast.success(`Added local endpoint ${trimmedName}.`);
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-border p-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-text-weak">
          Module
          <select
            value={moduleId}
            onChange={(event) => setModuleId(event.target.value)}
            className="rounded border border-border bg-bg-subtle px-2 py-1 text-[11px] text-text outline-none focus:border-accent"
          >
            {options.map((module) => (
              <option key={module.id} value={module.id}>
                {module.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-text-weak">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="llama.cpp local"
            className="rounded border border-border bg-bg-subtle px-2 py-1 text-[11px] text-text outline-none focus:border-accent"
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-[10px] uppercase tracking-wide text-text-weak">
          Base URL
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            placeholder="http://127.0.0.1:1234/v1"
            className="rounded border border-border bg-bg-subtle px-2 py-1 font-mono text-[11px] text-text outline-none focus:border-accent"
          />
        </label>
      </div>
      {error ? <p className="mt-1 text-[11px] text-danger">{error}</p> : null}
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded border border-border px-2 py-1 text-[11px] text-text-weak hover:text-text">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="rounded border border-accent bg-accent/15 px-2 py-1 text-[11px] text-text hover:bg-accent/25 disabled:opacity-40"
        >
          Add endpoint
        </button>
      </div>
    </div>
  );
}

export function ModelPalette() {
  const open = useAppStore((state) => state.modelPaletteOpen);
  const setOpen = useAppStore((state) => state.setModelPaletteOpen);
  const settings = useSettingsStore((state) => state.settings);
  const patch = useSettingsStore((state) => state.patch);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [modules, setModules] = useState<ProviderModuleDescriptor[]>([]);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, moduleList] = await Promise.all([window.api.providers.list(), window.api.providers.modules()]);
      setProviders(list);
      setModules(moduleList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    setAdding(false);
    void refresh();
    const handle = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(handle);
  }, [open, refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return providers
      .filter((provider) => provider.chatModels.length > 0)
      .map((provider) => ({
        provider,
        models: provider.chatModels.filter(
          (model) =>
            !q ||
            model.name.toLowerCase().includes(q) ||
            model.id.toLowerCase().includes(q) ||
            provider.name.toLowerCase().includes(q)
        )
      }))
      .filter((group) => group.models.length > 0);
  }, [providers, query]);

  const flat = useMemo(
    () => filtered.flatMap((group) => group.models.map((model) => ({ provider: group.provider, model }))),
    [filtered]
  );

  useEffect(() => setIndex(0), [query]);

  const select = useCallback(
    (providerId: string, model: ModelInfo) => {
      void patch({ activeProviderId: providerId, activeChatModel: model.id });
      setOpen(false);
    },
    [patch, setOpen]
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((current) => Math.min(current + 1, Math.max(flat.length - 1, 0)));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((current) => Math.max(current - 1, 0));
      } else if (event.key === "Enter") {
        const entry = flat[index];
        if (!entry) return;
        event.preventDefault();
        select(entry.provider.id, entry.model);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, flat, index, select, setOpen]);

  if (!open) return null;

  const activeProviderId = settings?.activeProviderId;
  const activeModel = settings?.activeChatModel;
  const existingIds = new Set(providers.map((provider) => provider.id));
  let running = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
      onMouseDown={() => setOpen(false)}
    >
      <div
        ref={containerRef}
        className="flex max-h-[70vh] w-[560px] flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Icon name="context" className="h-3.5 w-3.5 text-text-weak" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search models…"
            className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-weak"
          />
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded p-1 text-text-weak hover:text-text"
            title="Refresh models"
          >
            <Icon name="refresh" className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {error ? <p className="px-3 py-2 text-[11px] text-danger">{error}</p> : null}
          {!error && flat.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-text-weak">
              No models found. Start a local runtime, add an endpoint below, or set an API key in settings.
            </p>
          ) : null}
          {filtered.map((group) => (
            <div key={group.provider.id} className="mb-1">
              <div className="flex items-center justify-between px-3 py-1 text-[10px] uppercase tracking-wide text-text-weak">
                <span>{group.provider.name}</span>
                <span>{statusLabel(group.provider)}</span>
              </div>
              {group.models.map((model) => {
                running += 1;
                const isIndex = running === index;
                const selected = group.provider.id === activeProviderId && model.id === activeModel;
                return (
                  <button
                    key={`${group.provider.id}:${model.id}`}
                    type="button"
                    onMouseEnter={() => setIndex(flat.findIndex((entry) => entry.provider.id === group.provider.id && entry.model.id === model.id))}
                    onClick={() => select(group.provider.id, model)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] ${
                      isIndex ? "bg-bg-subtle text-text" : "text-text-weak hover:text-text"
                    }`}
                  >
                    <span className="w-3 shrink-0">{selected ? <Icon name="check" className="h-3 w-3 text-accent" /> : null}</span>
                    <span className="truncate">{model.name}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {adding ? (
          <AddLocalEndpointForm
            modules={modules}
            existingIds={existingIds}
            onAdded={refresh}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-2 border-t border-border px-3 py-2 text-left text-[11px] text-text-weak hover:text-text"
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
            Add local endpoint
          </button>
        )}
      </div>
    </div>
  );
}
