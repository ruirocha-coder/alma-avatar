"use client";

import {
  AvatarQuality,
  StreamingEvents,
  VoiceChatTransport,
  VoiceEmotion,
  StartAvatarRequest,
  STTProvider,
  ElevenLabsModel,
} from "@heygen/streaming-avatar";
import { useEffect, useRef, useState } from "react";
import { useMemoizedFn, useUnmount } from "ahooks";

import { Button } from "./Button";
import { AvatarConfig } from "./AvatarConfig";
import { AvatarVideo } from "./AvatarSession/AvatarVideo";
import { useStreamingAvatarSession } from "./logic/useStreamingAvatarSession";
import { AvatarControls } from "./AvatarSession/AvatarControls";
import { useVoiceChat } from "./logic/useVoiceChat";
import { StreamingAvatarProvider, StreamingAvatarSessionState } from "./logic";
import { LoadingIcon } from "./Icons";
import { MessageHistory } from "./AvatarSession/MessageHistory";

import { AVATARS } from "@/app/lib/constants";

/**
 * ⚙️ Config por defeito
 * – NÃO definimos `agent` (o tipo atual não suporta e,
 *   sem agente, o LLM interno fica desligado).
 * – language em pt-PT.
 * – ElevenLabs model conforme demo.
 */
const DEFAULT_CONFIG: StartAvatarRequest = {
  quality: AvatarQuality.Low,
  avatarName: AVATARS[0].avatar_id,
  knowledgeId: undefined,
  voice: {
    rate: 1.2,
    emotion: VoiceEmotion.EXCITED,
    model: ElevenLabsModel.eleven_flash_v2_5,
  },
  language: "pt-PT",
  voiceChatTransport: VoiceChatTransport.WEBSOCKET,
  sttSettings: {
    provider: STTProvider.DEEPGRAM,
  },
};

function InteractiveAvatarInner() {
  const { initAvatar, startAvatar, stopAvatar, sessionState, stream } =
    useStreamingAvatarSession();
  const { startVoiceChat } = useVoiceChat();

  const [config, setConfig] = useState<StartAvatarRequest>(DEFAULT_CONFIG);
  const mediaVideoRef = useRef<HTMLVideoElement>(null);

  // token de acesso (servido pelo teu /api/get-access-token)
  async function fetchAccessToken() {
    const res = await fetch("/api/get-access-token", { method: "POST" });
    if (!res.ok) throw new Error("Falha a obter access token");
    const token = await res.text();
    return token;
  }

  // Helper: chama o teu /api/alma com a transcrição final do utilizador
  async function askAlma(question: string): Promise<string> {
    const r = await fetch("/api/alma", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error("Erro /api/alma:", txt);
      return "Desculpa, não consegui obter resposta da Alma.";
    }
    const j = await r.json();
    return j.answer || "Sem resposta da Alma.";
  }

  // Iniciar sessão (voz ou texto) mantendo o fluxo do demo
  const startSession = useMemoizedFn(async (isVoiceChat: boolean) => {
    try {
      const token = await fetchAccessToken();
      const avatar = initAvatar(token);

      // Logs úteis
      avatar.on(StreamingEvents.AVATAR_START_TALKING, (e) =>
        console.log("Avatar started talking", e)
      );
      avatar.on(StreamingEvents.AVATAR_STOP_TALKING, (e) =>
        console.log("Avatar stopped talking", e)
      );
      avatar.on(StreamingEvents.STREAM_DISCONNECTED, () =>
        console.log("Stream disconnected")
      );
      avatar.on(StreamingEvents.STREAM_READY, (event) =>
        console.log(">>>>> Stream ready:", event.detail)
      );

      // Quando o utilizador termina a fala (ou mensagem),
      // envia para o teu backend e faz o avatar falar APENAS com a resposta da Alma.
      avatar.on(StreamingEvents.USER_END_MESSAGE, async (event: any) => {
        try {
          const userText =
            event?.detail?.transcript ||
            event?.detail?.text ||
            event?.detail?.message ||
            "";
          console.log("USER_END_MESSAGE text:", userText);

          if (!userText.trim()) return;

          const answer = await askAlma(userText);

          // Tentar interromper fala anterior (se exposto)
          if ((avatar as any)?.interrupt) {
            try {
              await (avatar as any).interrupt();
            } catch {
              /* noop */
            }
          }

          // Falar em PT-PT com a resposta da Alma.
          // API atual de speak aceita pelo menos { text }.
          await (avatar as any).speak({ text: answer });
        } catch (err) {
          console.error("Falha no pipeline USER_END_MESSAGE -> Alma -> speak", err);
        }
      });

      // Estes eventos ficam só para debug
      avatar.on(StreamingEvents.USER_START, (e) =>
        console.log(">>>>> User started talking:", e)
      );
      avatar.on(StreamingEvents.USER_STOP, (e) =>
        console.log(">>>>> User stopped talking:", e)
      );
      avatar.on(StreamingEvents.USER_TALKING_MESSAGE, (e) =>
        console.log(">>>>> User talking message:", e)
      );
      avatar.on(StreamingEvents.AVATAR_TALKING_MESSAGE, (e) =>
        console.log(">>>>> Avatar talking message:", e)
      );
      avatar.on(StreamingEvents.AVATAR_END_MESSAGE, (e) =>
        console.log(">>>>> Avatar end message:", e)
      );

      // Arranca o avatar com a config atual
      await startAvatar(config);

      // Se for voice chat, ligar micro
      if (isVoiceChat) {
        await startVoiceChat();
      }
    } catch (error) {
      console.error("Error starting avatar session:", error);
    }
  });

  // parar sessão ao desmontar
  useUnmount(() => {
    stopAvatar();
  });

  // ligar o stream de vídeo ao <video>
  useEffect(() => {
    if (stream && mediaVideoRef.current) {
      mediaVideoRef.current.srcObject = stream;
      mediaVideoRef.current.onloadedmetadata = () => {
        mediaVideoRef.current!.play();
      };
    }
  }, [stream]);

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex flex-col rounded-xl bg-zinc-900 overflow-hidden">
        <div className="relative w-full aspect-video overflow-hidden flex flex-col items-center justify-center">
          {sessionState !== StreamingAvatarSessionState.INACTIVE ? (
            <AvatarVideo ref={mediaVideoRef} />
          ) : (
            <AvatarConfig config={config} onConfigChange={setConfig} />
          )}
        </div>

        <div className="flex flex-col gap-3 items-center justify-center p-4 border-t border-zinc-700 w-full">
          {sessionState === StreamingAvatarSessionState.CONNECTED ? (
            <AvatarControls />
          ) : sessionState === StreamingAvatarSessionState.INACTIVE ? (
            <div className="flex flex-row gap-4">
              <Button onClick={() => startSession(true)}>Start Voice Chat</Button>
              <Button onClick={() => startSession(false)}>Start Text Chat</Button>
            </div>
          ) : (
            <LoadingIcon />
          )}
        </div>
      </div>

      {sessionState === StreamingAvatarSessionState.CONNECTED && <MessageHistory />}
    </div>
  );
}

export default function InteractiveAvatar() {
  return (
    <StreamingAvatarProvider basePath={process.env.NEXT_PUBLIC_BASE_API_URL}>
      <InteractiveAvatarInner />
    </StreamingAvatarProvider>
  );
}
