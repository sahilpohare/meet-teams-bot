#!/bin/bash

# Navigate to the sandbox directory
cd "$(dirname "$0")"

# Activate the virtual environment and run the test
source rabbitmq_env/bin/activate && python test_rabbitmq_queue.py 