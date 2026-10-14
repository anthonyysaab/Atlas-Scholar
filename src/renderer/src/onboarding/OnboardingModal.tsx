import { useEffect, useState } from "react";
import type { OnboardingStatus, ProviderInfo } from "@shared/types";
import { Modal } from "@renderer/components/Modal";
import { Icon } from "@renderer/components/Icon";
import { Button, Select, TextInput } from "@renderer/settings/fields";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { toast } from "@renderer/state/toastStore";

const STEPS = ["Welcome", "Chat model", "Embeddings"];

export function OnboardingModal({
  status,
  open,
  onClose
}: {
  status: OnboardingStatus;
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerId, setProviderId] = useState(status.suggestedChatProviderId ?? "");
  const [model, setModel] = useState(status.suggestedChatModel ?? "");
  const [embeddingProviderId, setEmbeddingProviderId] = useState(status.suggestedEmbeddingProviderId);
  const [embeddingModel, setEmbeddingModel] = useState(status.suggestedEmbeddingModel);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.api.providers
      .list()
      .then(setProviders)
      .catch(() => undefined);
  }, []);

  const chatModels = providers.find((provider) => provider.id === providerId)?.chatModels ?? [];

  const finish = async (choices: Parameters<typeof window.api.onboarding.complete>[0]): Promise<void> => {
    setBusy(true);
    try {
      await window.api.onboarding.complete(choices);
      await useSettingsStore.getState().load();
      toast.success("Setup complete. Open a document to get started.");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => void finish({})} title="Welcome to Reading Assistant" width="640px">
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-weak">
          {STEPS.map((label, index) => (
            <span key={label} className={index === step ? "text-text" : ""}>
              {index + 1}. {label}
            </span>
          ))}
        </div>

        {step === 0 ? (
          <div className="space-y-3 text-xs text-text-weak">
            <p className="leading-relaxed">
              Reading Assistant runs models locally or against your own API keys. Let's detect what is
              available and pick sensible defaults.
            </p>
            {status.detected.length > 0 ? (
              <div className="space-y-1">
                <p className="text-text">Detected local runtimes:</p>
                {status.detected.map((provider) => (
                  <p key={provider.id} className="flex items-center gap-2">
                    <Icon name="check" className="h-3 w-3 text-anno-green" />
                    {provider.name} · {provider.chatModels.length} model(s)
                  </p>
                ))}
              </div>
            ) : (
              <p className="flex items-center gap-2 text-text-weak">
                <Icon name="alert" className="h-3 w-3" /> No local runtime detected (Ollama :11434 or LM Studio
                :1234/:1235). You can still use a cloud provider with an API key.
              </p>
            )}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-3">
            <label className="flex flex-col gap-1 text-[11px] text-text-weak">
              Chat provider
              <Select
                value={providerId}
                onChange={(event) => {
                  const next = event.target.value;
                  setProviderId(next);
                  setModel(providers.find((provider) => provider.id === next)?.chatModels[0]?.id ?? "");
                }}
              >
                <option value="">Select a provider</option>
                {providers
                  .filter((provider) => provider.chatModels.length > 0)
                  .map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-text-weak">
              Chat model
              {chatModels.length > 0 ? (
                <Select value={model} onChange={(event) => setModel(event.target.value)}>
                  <option value="">Select a model</option>
                  {chatModels.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <TextInput value={model} onChange={(event) => setModel(event.target.value)} placeholder="model id" />
              )}
            </label>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-3">
            <p className="leading-relaxed text-xs text-text-weak">
              Grounded answers need an embedding model. The recommended offline default is{" "}
              <span className="font-mono text-text">nomic-embed-text</span> via Ollama. If it is missing, run{" "}
              <span className="font-mono text-text">ollama pull nomic-embed-text</span>.
            </p>
            <label className="flex flex-col gap-1 text-[11px] text-text-weak">
              Embedding provider
              <Select value={embeddingProviderId} onChange={(event) => setEmbeddingProviderId(event.target.value)}>
                <option value="">None</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-text-weak">
              Embedding model
              <TextInput
                value={embeddingModel}
                onChange={(event) => setEmbeddingModel(event.target.value)}
                placeholder="nomic-embed-text"
              />
            </label>
            <p className={`flex items-center gap-2 text-[11px] ${status.embeddingReady ? "text-anno-green" : "text-text-weak"}`}>
              <Icon name={status.embeddingReady ? "check" : "alert"} className="h-3 w-3" />
              {status.embeddingReady ? "Embedding model looks ready." : "We could not confirm the embedding model yet."}
            </p>
          </div>
        ) : null}

        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button onClick={() => void finish({})} disabled={busy}>
            Skip
          </Button>
          <div className="flex items-center gap-2">
            {step > 0 ? <Button onClick={() => setStep(step - 1)}>Back</Button> : null}
            {step < STEPS.length - 1 ? (
              <Button variant="primary" onClick={() => setStep(step + 1)}>
                Next
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void finish({ providerId, model, embeddingProviderId, embeddingModel })
                }
              >
                Finish
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
