import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Trash2, Upload, Mic, Square, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const N8N_WEBHOOK_URL =
  "https://digiventus.app.n8n.cloud/webhook/17a25868-119f-44a8-b5c6-ba3faad36bd5";

interface Recording {
  id: string;
  blob: Blob;
  duration: number;
  timestamp: number;
  transcription?: string;
}

const Index = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isUploading, setIsUploading] = useState<string | null>(null);
  const [currentlyPlaying, setCurrentlyPlaying] = useState<string | null>(null);
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(
    null
  );
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const durationInterval = useRef<number>();
  const startTime = useRef<number>(0);
  const audioPlayer = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  // Initialize IndexedDB
  useEffect(() => {
    const request = indexedDB.open("audioDB", 1);

    request.onerror = () => {
      console.error("Error opening IndexedDB");
      toast({
        title: "Error",
        description: "Could not initialize storage",
        variant: "destructive",
      });
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("recordings")) {
        db.createObjectStore("recordings", { keyPath: "id" });
      }
    };

    request.onsuccess = () => {
      loadRecordings();
    };
  }, []);

  const loadRecordings = () => {
    const request = indexedDB.open("audioDB", 1);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(["recordings"], "readonly");
      const store = transaction.objectStore("recordings");
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        setRecordings(getAllRequest.result);
      };
    };
  };

  const startRecording = async () => {
    try {
      // Advanced audio constraints for better quality
      const audioConstraints = {
        echoCancellation: true, // Reduces echo in the recording
        noiseSuppression: true, // Reduces background noise
        autoGainControl: true, // Enables automatic volume adjustment
        sampleRate: 44100, // CD-quality sample rate
        channelCount: 2, // Stereo recording
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });

      // Try to use Opus codec first, fall back to standard WebM if not supported
      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/webm";
      }

      mediaRecorder.current = new MediaRecorder(stream, {
        mimeType: mimeType,
      });

      mediaRecorder.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.current.push(e.data);
        }
      };

      mediaRecorder.current.onstop = () => {
        const actualDuration = Math.floor(
          (Date.now() - startTime.current) / 1000
        );
        const blob = new Blob(chunks.current, { type: mimeType });
        const recording: Recording = {
          id: Date.now().toString(),
          blob,
          duration: actualDuration,
          timestamp: Date.now(),
        };

        // Save to IndexedDB
        const request = indexedDB.open("audioDB", 1);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(["recordings"], "readwrite");
          const store = transaction.objectStore("recordings");
          store.add(recording);
          loadRecordings();
        };

        chunks.current = [];
        setRecordingDuration(0);
      };

      startTime.current = Date.now();
      mediaRecorder.current.start(200);
      setIsRecording(true);

      // Start duration counter
      setRecordingDuration(0);
      durationInterval.current = window.setInterval(() => {
        const currentDuration = Math.floor(
          (Date.now() - startTime.current) / 1000
        );
        setRecordingDuration(currentDuration);
      }, 1000);
    } catch (error) {
      console.error("Error accessing microphone:", error);
      toast({
        title: "Error",
        description: "Could not access microphone",
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && mediaRecorder.current.state !== "inactive") {
      mediaRecorder.current.stop();
      mediaRecorder.current.stream.getTracks().forEach((track) => track.stop());
      clearInterval(durationInterval.current);
      setIsRecording(false);
    }
  };

  const deleteRecording = (id: string) => {
    const request = indexedDB.open("audioDB", 1);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(["recordings"], "readwrite");
      const store = transaction.objectStore("recordings");
      store.delete(id);
      loadRecordings();
      toast({
        title: "Success",
        description: "Recording deleted",
      });
    };
  };

  const uploadRecording = async (recording: Recording) => {
    setIsUploading(recording.id);
    const formData = new FormData();
    formData.append("file", recording.blob, `recording-${recording.id}.webm`);

    try {
      const response = await fetch(N8N_WEBHOOK_URL, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("Upload failed");

      const data = await response.json();

      // Update the recording with the transcription
      const updatedRecording = { ...recording, transcription: data.text };

      // Update in IndexedDB
      const request = indexedDB.open("audioDB", 1);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(["recordings"], "readwrite");
        const store = transaction.objectStore("recordings");
        store.put(updatedRecording);
        loadRecordings();
      };

      toast({
        title: "Success",
        description: "Recording uploaded and transcribed successfully",
      });
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Error",
        description: "Failed to upload recording",
        variant: "destructive",
      });
    } finally {
      setIsUploading(null);
    }
  };

  const showTranscription = (recording: Recording) => {
    setSelectedRecording(recording);
  };

  const playRecording = (recording: Recording) => {
    if (currentlyPlaying === recording.id) {
      audioPlayer.current?.pause();
      setCurrentlyPlaying(null);
      return;
    }

    const url = URL.createObjectURL(recording.blob);
    if (audioPlayer.current) {
      audioPlayer.current.src = url;
      audioPlayer.current.play();
      setCurrentlyPlaying(recording.id);

      audioPlayer.current.onended = () => {
        setCurrentlyPlaying(null);
        URL.revokeObjectURL(url);
      };
    }
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="min-h-screen p-4 max-w-2xl mx-auto">
      <div className="flex flex-col items-center mb-8">
        <Button
          onClick={isRecording ? stopRecording : startRecording}
          className={cn(
            "w-32 h-32 rounded-full transition-all duration-300",
            isRecording
              ? "bg-red-500 hover:bg-red-600"
              : "bg-indigo-600 hover:bg-indigo-700"
          )}
        >
          {isRecording ? (
            <Square className="w-8 h-8" />
          ) : (
            <Mic className="w-8 h-8" />
          )}
        </Button>
        {isRecording && (
          <div className="mt-4 text-xl font-medium">
            {formatDuration(recordingDuration)}
          </div>
        )}
      </div>

      <audio ref={audioPlayer} className="hidden" />

      <div className="space-y-4">
        {recordings.map((recording) => (
          <div
            key={recording.id}
            className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow flex items-center justify-between"
          >
            <div>
              <div className="font-medium">
                {formatDate(recording.timestamp)}
              </div>
              <div className="text-sm text-gray-500">
                Duration: {formatDuration(recording.duration)}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="icon"
                onClick={() => deleteRecording(recording.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                onClick={() => uploadRecording(recording)}
                disabled={isUploading === recording.id}
              >
                {isUploading === recording.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => playRecording(recording)}
                className={cn(
                  currentlyPlaying === recording.id &&
                    "bg-indigo-100 dark:bg-indigo-900"
                )}
              >
                <Play className="w-4 h-4" />
              </Button>
              {recording.transcription && (
                <Button
                  variant="outline"
                  onClick={() => showTranscription(recording)}
                >
                  Show Text
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Dialog
        open={selectedRecording !== null}
        onOpenChange={() => setSelectedRecording(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex justify-between items-center">
              <span>Transcription</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedRecording(null)}
                className="h-8 w-8 p-0"
              ></Button>
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
            <p className="text-lg leading-relaxed">
              {selectedRecording?.transcription}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
