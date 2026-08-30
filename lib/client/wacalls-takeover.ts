const sampleRate = 16_000;

function encodePCM(samples: Float32Array) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  samples.forEach((raw, index) => {
    const sample = Math.max(-1, Math.min(1, Number.isNaN(raw) ? 0 : raw));
    view.setInt16(index * 2, sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767), true);
  });
  return buffer;
}

function decodePCM(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const output = new Float32Array(Math.floor(buffer.byteLength / 2));
  for (let index = 0; index < output.length; index += 1) output[index] = view.getInt16(index * 2, true) / 32768;
  return output;
}

export async function openWhatsAppTakeover(operationId: string) {
  const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
  const connection = new RTCPeerConnection({ iceServers: [] });
  const channel = connection.createDataChannel("pcm", { ordered: true });
  channel.binaryType = "arraybuffer";
  const context = new AudioContext({ sampleRate });
  const speaker = new Audio();
  const close = () => {
    microphone.getTracks().forEach((track) => track.stop());
    speaker.pause();
    void context.close();
    connection.close();
  };

  try {
    await context.audioWorklet.addModule("/worklets/capture-processor.js");
    await context.audioWorklet.addModule("/worklets/playback-processor.js");
    await context.resume();

    const source = context.createMediaStreamSource(microphone);
    const capture = new AudioWorkletNode(context, "capture-processor");
    capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (channel.readyState === "open") channel.send(encodePCM(event.data));
    };
    source.connect(capture);
    capture.connect(context.destination);

    const playback = new AudioWorkletNode(context, "playback-processor");
    const destination = context.createMediaStreamDestination();
    playback.connect(destination);
    channel.onmessage = (event: MessageEvent<ArrayBuffer>) => playback.port.postMessage(decodePCM(event.data));

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    await new Promise<void>((resolve) => {
      if (connection.iceGatheringState === "complete") resolve();
      else connection.addEventListener("icegatheringstatechange", () => {
        if (connection.iceGatheringState === "complete") resolve();
      });
    });
    const response = await fetch(`/api/operations/${operationId}/takeover/webrtc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sdpOffer: connection.localDescription?.sdp }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Live takeover failed");
    await connection.setRemoteDescription({ type: "answer", sdp: body.data.sdpAnswer });
    await new Promise<void>((resolve, reject) => {
      if (channel.readyState === "open") return resolve();
      const timeout = window.setTimeout(() => reject(new Error("Browser audio channel did not connect")), 15_000);
      channel.addEventListener("open", () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
      channel.addEventListener("close", () => {
        window.clearTimeout(timeout);
        reject(new Error("Browser audio channel closed before takeover"));
      }, { once: true });
    });
    const connectedResponse = await fetch(`/api/operations/${operationId}/takeover/webrtc`, { method: "PATCH" });
    const connectedBody = await connectedResponse.json();
    if (!connectedResponse.ok) throw new Error(connectedBody.error ?? "Takeover confirmation failed");
    speaker.autoplay = true;
    speaker.srcObject = destination.stream;
    await speaker.play();
    return { snapshot: connectedBody.data, close };
  } catch (error) {
    close();
    throw error;
  }
}
