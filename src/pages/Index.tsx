import { useEffect, useState, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Trash2, Upload, Mic, Square, Play } from "lucide-react";
import { cn } from "@/lib/utils";

const N8N_WEBHOOK_URL = 'https://my-n8n-instance.com/webhook/1234';

interface Recording {
  id: string;
  blob: Blob;
  duration: number;
  timestamp: number;
}

const Index = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isUploading, setIsUploading] = useState<string | null>(null);
  const [currentlyPlaying, setCurrentlyPlaying] = useState<string | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const durationInterval = useRef<number>();
  const audioPlayer = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  // Initialize IndexedDB
  useEffect(() => {
    const request = indexedDB.open('audioDB', 1);

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
      if (!db.objectStoreNames.contains('recordings')) {
        db.createObjectStore('recordings', { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      loadRecordings();
    };
  }, []);

  // Load recordings from IndexedDB
  const loadRecordings = () => {
    const request = indexedDB.open('audioDB', 1);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['recordings'], 'readonly');
      const store = transaction.objectStore('recordings');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        setRecordings(getAllRequest.result);
      };
    };
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream, {
        mimeType: 'audio/webm'
      });

      mediaRecorder.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.current.push(e.data);
        }
      };

      mediaRecorder.current.onstop = () => {
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        const recording: Recording = {
          id: Date.now().toString(),
          blob,
          duration: recordingDuration,
          timestamp: Date.now(),
        };

        // Save to IndexedDB
        const request = indexedDB.open('audioDB', 1);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(['recordings'], 'readwrite');
          const store = transaction.objectStore('recordings');
          store.add(recording);
          loadRecordings();
        };

        chunks.current = [];
        setRecordingDuration(0);
      };

      mediaRecorder.current.start(200); // Start recording and get data every 200ms
      setIsRecording(true);
      
      // Start duration counter
      setRecordingDuration(0);
      durationInterval.current = window.setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('Error accessing microphone:', error);
      toast({
        title: "Error",
        description: "Could not access microphone",
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
      mediaRecorder.current.stop();
      mediaRecorder.current.stream.getTracks().forEach(track => track.stop());
      clearInterval(durationInterval.current);
      setIsRecording(false);
    }
  };

  const deleteRecording = (id: string) => {
    const request = indexedDB.open('audioDB', 1);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['recordings'], 'readwrite');
      const store = transaction.objectStore('recordings');
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
    formData.append('file', recording.blob, `recording-${recording.id}.webm`);

    try {
      const response = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Upload failed');

      toast({
        title: "Success",
        description: "Recording uploaded successfully",
      });
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Error",
        description: "Failed to upload recording",
        variant: "destructive",
      });
    } finally {
      setIsUploading(null);
    }
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
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
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
            isRecording ? "bg-red-500 hover:bg-red-600" : "bg-indigo-600 hover:bg-indigo-700"
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
              <div className="font-medium">{formatDate(recording.timestamp)}</div>
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
                  currentlyPlaying === recording.id && "bg-indigo-100 dark:bg-indigo-900"
                )}
              >
                <Play className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Index;