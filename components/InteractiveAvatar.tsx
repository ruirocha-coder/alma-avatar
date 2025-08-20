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

const DEFAULT_CONFIG: StartAvatarRequest = {
  quality: AvatarQuality.Low,
  avatarName: AVATARS[0].avatar_id,
  knowledgeId: undefined, // não usar KB deles
  voice: {
    rate: 1.5,
    emotion: VoiceEmotion.EXCITED,
    model: ElevenLabsModel.eleven_flash_v2_5,
  },
  language: "en", // a voz final será controlada pelo speak()
  voiceChatTransport: VoiceChatTransport.WEBSOCKET,
  sttSettings: {
    provider: STTProvider.DEEPGRAM,
  },
};

function InteractiveAvatar() {
  const { initAvatar, startAvatar, stopAvatar, sessionState, stream } =
    useStreamingAvatarSession();
  const { startVoiceChat } = useVoiceChat();

  const [config, setConfig] = useState<StartAvatarRequest>(DEFAULT_CONFIG);
  const mediaStream = useRef<HTMLVideoElement>(null);

  // --- controlo da “mão”: só fala quando o Grok responder
  const [awaitingAlma, setAwaitingAlma] = useState(false);
  const userBufferRef = useRef<string>(""); // texto do utilizador agregado por STT
  const avatarRef = useRef<any>(null);

  async function fetchAccessToken() {
    const response = await fetch("/api/get-access-token", { method: "POST" });
    const token = await response.text();
    return token;
  }

  // manda pergunta ao proxy Next -> Alma Server (Grok)
  async function askAlma(question: string): Promise<string> {
    try {
      const r = await fetch("/api/alma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const j = await r.json();
      return j.answer || "Não consegui obter resposta da Alma.";
    } catch (e: any) {
      return "Erro a contactar o Alma Server: " + (e?.message || e);
    }
  }

  // interrompe fala automática do HeyGen enquanto aguardamos o Grok
  const safeInterrupt = useMemoizedFn(async () => {
    try {
      if (awaitingAlma && avatarRef.current?.interrupt) {
        await avatarRef.current.interrupt();
      }
    } catch (_) {
      // ignora
    }
  });

  const startSessionV2 = useMemoizedFn(async (isVoiceChat: boolean) => {
    try {
      const newToken = await fetchAccessToken();
      const avatar = initAvatar(newToken);
      avatarRef.current = avatar;

      // --- Eventos do fluxo
      avatar.on(StreamingEvents.AVATAR_START_TALKING, async () => {
        // se o LLM interno tentar falar antes do Grok: corta
        await safeInterrupt();
      });

      avatar.on(StreamingEvents.AVATAR_TALKING_MESSAGE, async () => {
        await safeInterrupt();
      });

      avatar.on(StreamingEvents.AVATAR_END_MESSAGE, () => {
        // noop
      });

      // acumula texto do utilizador durante a fala
      avatar.on(StreamingEvents.USER_TALKING_MESSAGE, (event: any) => {
        const chunk = event?.detail?.text ?? "";
        if (chunk) {
          userBufferRef.current += (userBufferRef.current ? " " : "") + chunk;
        }
      });

      // quando o utilizador termina a fala → chamamos o Grok
      avatar.on(StreamingEvents.USER_END_MESSAGE, async () => {
        const question = userBufferRef.current.trim();
        userBufferRef.current = "";

        if (!question) return;

        setAwaitingAlma(true);
        // redundância: se o HeyGen já começou a falar, interrompe
        await safeInterrupt();

        const answer = await askAlma(question);

        // agora libertamos o “gate” e deixamos o avatar falar o texto da Alma
        setAwaitingAlma(false);

        try {
          await avatar.speak({
            text: answer,
            // se a SDK suportar língua/voz aqui, podes definir:
            // voiceId: process.env.NEXT_PUBLIC_HEYGEN_VOICE_ID,
          });
        } catch (e) {
          // falha no speak não deve crashar UI
          console.error("Falha no speak()", e);
        }
      });

      // logging útil
      avatar.on(StreamingEvents.STREAM_READY, (e) => {
        console.log("STREAM_READY", e?.detail);
      });
      avatar.on(StreamingEvents.USER_START, () => {
        // começa novo buffer de pergunta
        userBufferRef.current = "";
      });
      avatar.on(StreamingEvents.USER_STOP, () => {});

      await startAvatar(config);

      if (isVoiceChat) {
        await startVoiceChat();
      }
    } catch (error) {
      console.error("Error starting avatar session:", error);
    }
  });

  useUnmount(() => {
    stopAvatar();
  });

  useEffect(() => {
    if (stream && mediaStream.current) {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => {
        mediaStream.current!.play();
      };
    }
  }, [mediaStream, stream]);

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex flex-col rounded-xl bg-zinc-900 overflow-hidden">
        <div className="relative w-full aspect-video overflow-hidden flex flex-col items-center justify-center">
          {sessionState !== StreamingAvatarSessionState.INACTIVE ? (
            <AvatarVideo ref={mediaStream} />
          ) : (
            <AvatarConfig config={config} onConfigChange={setConfig} />
          )}
        </div>

        <div className="flex flex-col gap-3 items-center justify-center p-4 border-t border-zinc-700 w-full">
          {sessionState === StreamingAvatarSessionState.CONNECTED ? (
            <AvatarControls />
          ) : sessionState === StreamingAvatarSessionState.INACTIVE ? (
            <div className="flex flex-row gap-4">
              <Button onClick={() => startSessionV2(true)}>
                Start Voice Chat
              </Button>
              <Button onClick={() => startSessionV2(false)}>
                Start Text Chat
              </Button>
            </div>
          ) : (
            <LoadingIcon />
          )}
          {awaitingAlma && (
            <div className="text-xs text-zinc-400">
              A pensar com o Grok…
            </div>
          )}
        </div>
      </div>

      {sessionState === StreamingAvatarSessionState.CONNECTED && (
        <MessageHistory />
      )}
    </div>
  );
}

export default function InteractiveAvatarWrapper() {
  return (
    <StreamingAvatarProvider basePath={process.env.NEXT_PUBLIC_BASE_API_URL}>
      <InteractiveAvatar />
    </StreamingAvatarProvider>
  );
}
