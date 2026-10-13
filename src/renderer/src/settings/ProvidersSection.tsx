import { useCallback, useEffect, useState } from "react";
import type { ProviderInfo, ProviderModuleDescriptor, StoredProvider } from "@shared/types";
import { Icon } from "@renderer/components/Icon";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { toast } from "@renderer/state/toastStore";
import { Button, Section, Select, TextInput } from "./fields";

const ID_RE = /^[a-zA-Z0-9._-]+$/;

function toStored(info: ProviderInfo, overrides?: Partial<StoredProvider>): StoredProvider | null {
  if (!info.moduleId) return null;
  return {
    id: info.id,
    name: info.name,
    moduleId: info.moduleId,
    kind: info.kind,
    baseUrl: info.baseUrl ?? "",
    needsSecret: info.needsSecret ?? info.kind === "remote",
    ...overrides
  };
}

function ProviderRow({
  info,
  onUpsert,
  onRemove,
  onSecretChanged
}: {
  info: ProviderInfo;
  onUpsert: (provider: StoredProvider) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onSecretChanged: () => Promise<void>;
}) {
  const keysConfigured = useSettingsStore((state) => state.settings?.keysConfigured ?? {});
  const [baseUrl, setBaseUrl] = useState(info.baseUrl ?? "");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setBaseUrl(info.baseUrl ?? ""), [info.baseUrl]);

  const commitBaseUrl = async (): Promise<void> => {
    const stored = toStored(info, { baseUrl: baseUrl.trim() });
    if (stored && stored.baseUrl !== (info.baseUrl ?? "")) await onUpsert(stored);
  };

  const runTest = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.api.providers.test(info.id);
      if (result.ok) toast.success(`${info.name} is reachable.`);
      else toast.error(`${info.name}: ${result.error ?? "not reachable"}`);
    } finally {
      setBusy(false);
    }
  };

  const saveSecret = async (): Promise<void> => {
    if (!secret.trim()) return;
    await window.api.settings.setSecret(info.id, secret.trim());
    setSecret("");
    await onSecretChanged();
    toast.success(`Saved API key for ${info.name}.`);
  };

  const clearSecret = async (): Promise<void> => {
    await window.api.settings.clearSecret(info.id);
    await onSecretChanged();
    toast.info(`Cleared API key for ${info.name}.`);
  };

  const hasKey = keysConfigured[info.id] === true;

  return (
    <div className="rounded-md border border-border bg-bg-subtle p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium text-text">{info.name}</span>
          <span className="shrink-0 rounded bg-panel px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-weak">
            {info.kind}
          </span>
          {info.kind === "local" ? (
            <span className={`shrink-0 text-[10px] ${info.running ? "text-anno-green" : "text-text-weak"}`}>
              {info.running ? "running" : "offline"}
            </span>
          ) : info.needsSecret ? (
            <span className={`shrink-0 text-[10px] ${hasKey ? "text-anno-green" : "text-anno-pink"}`}>
              {hasKey ? "key set" : "no key"}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button onClick={() => void runTest()} disabled={busy}>
            Test
          </Button>
          <Button variant="danger" onClick={() => void onRemove(info.id)} aria-label={`Remove ${info.name}`}>
            <Icon name="trash" className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <TextInput
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          onBlur={() => void commitBaseUrl()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          placeholder="Base URL"
          className="min-w-0 flex-1 font-mono"
        />
      </div>

      {info.needsSecret ? (
        <div className="mt-2 flex items-center gap-2">
          <TextInput
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder={hasKey ? "Replace API key…" : "API key"}
            className="min-w-0 flex-1"
          />
          <Button variant="primary" onClick={() => void saveSecret()} disabled={!secret.trim()}>
            Set key
          </Button>
          {hasKey ? (
            <Button onClick={() => void clearSecret()}>
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AddProviderForm({
  modules,
  existingIds,
  onAdd
}: {
  modules: ProviderModuleDescriptor[];
  existingIds: Set<string>;
  onAdd: (provider: StoredProvider) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [moduleId, setModuleId] = useState(modules[0]?.id ?? "openai-compatible");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const module = modules.find((entry) => entry.id === moduleId);
    if (module) setBaseUrl(module.defaultBaseUrl);
  }, [moduleId, modules]);

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        <span className="inline-flex items-center gap-1">
          <Icon name="plus" className="h-3.5 w-3.5" /> Add provider
        </span>
      </Button>
    );
  }

  const submit = async (): Promise<void> => {
    const module = modules.find((entry) => entry.id === moduleId);
    const trimmedId = id.trim() || name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
    const trimmedName = name.trim() || trimmedId;
    if (!ID_RE.test(trimmedId)) {
      setError("Use letters, numbers, dot, dash, or underscore for the id.");
      return;
    }
    if (existingIds.has(trimmedId)) {
      setError("A provider with that id already exists.");
      return;
    }
    if (!module) {
      setError("Choose a provider module.");
      return;
    }
    await onAdd({
      id: trimmedId,
      name: trimmedName,
      moduleId: module.id,
      kind: module.kind,
      baseUrl: baseUrl.trim() || module.defaultBaseUrl,
      needsSecret: module.needsSecret
    });
    setOpen(false);
    setId("");
    setName("");
    setError(null);
  };

  return (
    <div className="space-y-2 rounded-md border border-border bg-bg-subtle p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[11px] text-text-weak">
          Module
          <Select value={moduleId} onChange={(event) => setModuleId(event.target.value)}>
            {modules.map((module) => (
              <option key={module.id} value={module.id}>
                {module.name} · {module.kind}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-text-weak">
          Name
          <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="My endpoint" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-text-weak">
          Id
          <TextInput value={id} onChange={(event) => setId(event.target.value)} placeholder="my-endpoint" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-text-weak">
          Base URL
          <TextInput value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} className="font-mono" />
        </label>
      </div>
      {error ? <p className="text-[11px] text-danger">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="primary" onClick={() => void submit()}>
          Add
        </Button>
      </div>
    </div>
  );
}

export function ProvidersSection() {
  const patch = useSettingsStore((state) => state.patch);
  const load = useSettingsStore((state) => state.load);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [modules, setModules] = useState<ProviderModuleDescriptor[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, moduleList] = await Promise.all([window.api.providers.list(), window.api.providers.modules()]);
      setProviders(list);
      setModules(moduleList);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upsert = useCallback(
    async (provider: StoredProvider) => {
      const current = useSettingsStore.getState().settings?.providers ?? [];
      const next = [...current.filter((entry) => entry.id !== provider.id), provider];
      const hidden = (useSettingsStore.getState().settings?.hiddenProviders ?? []).filter((id) => id !== provider.id);
      await patch({ providers: next, hiddenProviders: hidden });
      await refresh();
    },
    [patch, refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      const current = useSettingsStore.getState().settings?.providers ?? [];
      const hidden = useSettingsStore.getState().settings?.hiddenProviders ?? [];
      await patch({
        providers: current.filter((entry) => entry.id !== id),
        hiddenProviders: hidden.includes(id) ? hidden : [...hidden, id]
      });
      await refresh();
    },
    [patch, refresh]
  );

  const existingIds = new Set(providers.map((provider) => provider.id));

  return (
    <Section
      title="Providers"
      description="Built-in providers can be edited in place; add custom OpenAI-compatible or local endpoints. Keys are stored with OS encryption and never leave the main process."
    >
      <div className="space-y-2">
        {loading ? <p className="text-xs text-text-weak">Loading providers…</p> : null}
        {!loading && providers.length === 0 ? <p className="text-xs text-text-weak">No providers available.</p> : null}
        {providers.map((provider) => (
          <ProviderRow
            key={provider.id}
            info={provider}
            onUpsert={upsert}
            onRemove={remove}
            onSecretChanged={() => load()}
          />
        ))}
      </div>
      <AddProviderForm modules={modules} existingIds={existingIds} onAdd={upsert} />
    </Section>
  );
}
