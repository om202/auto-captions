from firebase_functions import https_fn, options, storage_fn
from firebase_admin import initialize_app, firestore, storage
import google.cloud.firestore
from google.cloud import speech
import tempfile
import os
from moviepy.editor import VideoFileClip

# Initialize Firebase Admin
initialize_app()

@https_fn.on_request(
    cors=options.CorsOptions(
        cors_origins="*",
        cors_methods=["post"],
    )
)
def generate_subtitles(req: https_fn.Request) -> https_fn.Response:
    """Generate subtitles from uploaded video"""
    try:
        data = req.get_json()
        
        if not data or 'video_path' not in data:
            return https_fn.Response(
                json={"success": False, "error": "video_path required"},
                status=400
            )
        
        video_path = data['video_path']
        
        # Create processing job in Firestore
        db = firestore.client()
        job_ref = db.collection('subtitle_jobs').document()
        job_ref.set({
            'video_path': video_path,
            'status': 'processing',
            'created_at': firestore.SERVER_TIMESTAMP
        })
        
        # Get video from storage
        bucket = storage.bucket()
        blob = bucket.blob(video_path)
        
        # Download video to temp file
        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as video_file:
            blob.download_to_filename(video_file.name)
            video_temp_path = video_file.name
        
        # Extract audio from video
        audio_temp_path = video_temp_path.replace('.mp4', '.wav')
        video_clip = VideoFileClip(video_temp_path)
        video_clip.audio.write_audiofile(audio_temp_path, fps=16000)
        video_clip.close()
        
        # Transcribe audio using Google Speech-to-Text
        speech_client = speech.SpeechClient()
        
        with open(audio_temp_path, 'rb') as audio_file:
            audio_content = audio_file.read()
        
        audio = speech.RecognitionAudio(content=audio_content)
        config = speech.RecognitionConfig(
            encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
            sample_rate_hertz=16000,
            language_code="en-US",
            enable_word_time_offsets=True,
        )
        
        response = speech_client.recognize(config=config, audio=audio)
        
        # Generate SRT format subtitles
        subtitles = []
        subtitle_index = 1
        
        for result in response.results:
            alternative = result.alternatives[0]
            
            if alternative.words:
                start_time = alternative.words[0].start_time.total_seconds()
                end_time = alternative.words[-1].end_time.total_seconds()
                
                subtitles.append({
                    'index': subtitle_index,
                    'start': start_time,
                    'end': end_time,
                    'text': alternative.transcript
                })
                subtitle_index += 1
        
        # Generate SRT content
        srt_content = generate_srt(subtitles)
        
        # Save SRT to storage
        srt_path = video_path.replace('.mp4', '.srt')
        srt_blob = bucket.blob(srt_path)
        srt_blob.upload_from_string(srt_content)
        
        # Update job status
        job_ref.update({
            'status': 'completed',
            'srt_path': srt_path,
            'subtitles': subtitles,
            'completed_at': firestore.SERVER_TIMESTAMP
        })
        
        # Cleanup temp files
        os.unlink(video_temp_path)
        os.unlink(audio_temp_path)
        
        return https_fn.Response(
            json={
                "success": True,
                "job_id": job_ref.id,
                "srt_path": srt_path,
                "subtitles": subtitles
            },
            status=200
        )
        
    except Exception as e:
        # Update job with error if job_ref exists
        if 'job_ref' in locals():
            job_ref.update({
                'status': 'failed',
                'error': str(e),
                'completed_at': firestore.SERVER_TIMESTAMP
            })
        
        return https_fn.Response(
            json={"success": False, "error": str(e)},
            status=500
        )


def generate_srt(subtitles):
    """Convert subtitle data to SRT format"""
    srt_content = ""
    
    for sub in subtitles:
        start_time = format_time(sub['start'])
        end_time = format_time(sub['end'])
        
        srt_content += f"{sub['index']}\n"
        srt_content += f"{start_time} --> {end_time}\n"
        srt_content += f"{sub['text']}\n\n"
    
    return srt_content


def format_time(seconds):
    """Format seconds to SRT time format (HH:MM:SS,mmm)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
