#!/usr/bin/env python3
import json
import sys

import pika

# Your AMQP connection details
amqp_url = "amqps://rabbit:wNDVTc2nknzJ69_CxtfG@b-8e0f5445-d60b-4c4d-b8e6-404cacac8a9f.mq.eu-west-3.amazonaws.com:5671"

# Message payload
payload = {
    "session_id": "production-session",
    "meeting_url": "https://meet.google.com/amh-ctjw-gzo?authuser=0",
    "user_token": "PHIPHI7-token",
    "bot_name": "PHIPHI7-SUPERTOTO",
    "user_id": 123,
    "email": "bot@example.com",
    "bot_branding": False,
    "event": None,
    "custom_branding_bot_path": "https://i.ibb.co/N9YtnDZ/ducobu.jpg",
    "speech_to_text_provider": None,
    "speech_to_text_api_key": "",
    "streaming_input": "",
    "streaming_output": "",
    "streaming_audio_frequency": 24000,
    "bot_uuid": "PHIPHI7",
    "enter_message": "Recording bot has joined the meeting",
    "bots_api_key": "your-api-key-here",
    "bots_webhook_url": "",
    "automatic_leave": {"waiting_room_timeout": 600, "noone_joined_timeout": 600},
    "recording_mode": "speaker_view",
    "mp4_s3_path": "recordings/output.mp4",
    "extra": None,
    "secret": "PHIPHI7",
    "zoom_sdk_id": None,
    "zoom_sdk_pwd": None,
    "transcription_custom_parameters": None,
}

try:
    print("Connecting to RabbitMQ...")
    # Connect to RabbitMQ
    connection = pika.BlockingConnection(pika.URLParameters(amqp_url))
    channel = connection.channel()

    print("Connected successfully!")
    print("Publishing message to worker_bot_queue...")

    # Publish message
    channel.basic_publish(
        exchange="",
        routing_key="worker_bot_queue",
        body=json.dumps(payload),
        properties=pika.BasicProperties(
            delivery_mode=2,  # Make message persistent
        ),
    )

    print("Message sent successfully!")
    print(f"Payload: {json.dumps(payload, indent=2)}")
    connection.close()

except Exception as e:
    print(f"Error: {e}")
    sys.exit(1) 