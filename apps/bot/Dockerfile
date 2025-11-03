# Meeting Bot - Docker Image for Screen Recording
FROM ubuntu:24.04

# Combine all system installations in one layer to reduce image size
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Bun dependencies
    curl ca-certificates gnupg unzip \
    # Core browser dependencies (minimal set)
    wget libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxrandr2 libgbm1 libxss1 libxshmfence1 \
    # Virtual display and audio (KEEP ALL - needed for bot functionality)
    xvfb x11vnc x11-utils pulseaudio pulseaudio-utils unclutter \
    # Media processing (only what's needed for recording)
    ffmpeg \
    # AWS CLI dependencies (aggressive cleanup to save ~60MB)
    && curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip -q awscliv2.zip \
    && ./aws/install \
    && rm -rf awscliv2.zip aws \
    # Remove AWS CLI bloat - keep only S3 commands
    && rm -rf /usr/local/aws-cli/v2/*/dist/aws_completer \
    && rm -rf /usr/local/aws-cli/v2/*/dist/awscli/data/ac.index \
    && rm -rf /usr/local/aws-cli/v2/*/dist/awscli/examples \
    && rm -rf /usr/local/aws-cli/v2/*/dist/awscli/botocore/data/[a-r]* \
    && rm -rf /usr/local/aws-cli/v2/*/dist/awscli/botocore/data/[t-z]* \
    # Install Bun
    && curl -fsSL https://bun.sh/install | bash \
    # Aggressive cleanup to reduce layer size
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* /var/cache/* \
    && rm -rf /root/.cache /usr/share/doc /usr/share/man \
    # Remove unnecessary font files to save ~30MB
    && rm -rf /usr/share/fonts/truetype/noto /usr/share/fonts/truetype/dejavu

ENV PATH="/root/.bun/bin:${PATH}"

# Application setup
WORKDIR /app

# Copy package files (bun.lock might not exist in monorepo app)
COPY package.json ./

# Install all dependencies (including devDependencies for build)
RUN bun install --no-cache

# Install Playwright's Chromium + aggressive cleanup to save ~200-300MB
RUN bunx playwright install chromium --with-deps \
    && find /root/.cache/ms-playwright -name chrome -type f -executable | head -1 | xargs -I {} ln -sf {} /usr/bin/google-chrome \
    # Remove unnecessary Playwright files to save space
    && rm -rf /root/.cache/ms-playwright/chromium-*/chrome-linux/swiftshader \
    && rm -rf /root/.cache/ms-playwright/chromium-*/chrome-linux/locales \
    && find /root/.cache/ms-playwright -name "*.pak" -type f ! -name "en-US.pak" -delete \
    # Remove chromium_headless_shell (not needed if we have full chromium)
    && rm -rf /root/.cache/ms-playwright/chromium_headless_shell-* \
    # Strip debug symbols from chromium binary to save ~100-150MB
    && find /root/.cache/ms-playwright -type f -executable -exec strip --strip-unneeded {} \; 2>/dev/null || true \
    # Remove Playwright FFMPEG (we already have system ffmpeg)
    && rm -rf /root/.cache/ms-playwright/ffmpeg-*

# Build application
COPY . .
RUN bun run build \
    # Remove devDependencies and source files after build to reduce image size
    && bun install --production \
    && rm -rf src tests *.md .git* node_modules/@types \
    && rm -rf /root/.bun/install/cache /tmp/* /var/tmp/* \
    # Remove unnecessary node_modules folders (docs, examples, tests)
    && find node_modules -type d -name "test" -o -name "tests" -o -name "*.md" -o -name "example" -o -name "examples" -o -name "docs" | xargs rm -rf \
    && find node_modules -name "*.ts" ! -name "*.d.ts" -delete \
    # Cleanup Bun cache and temporary files
    && rm -rf /root/.cache/* /root/.npm /root/.bun/install

# Environment configuration
ENV NODE_OPTIONS="--max-old-space-size=2048"
ENV SERVERLESS=true
ENV NODE_ENV=production
ENV DISPLAY=:99
ENV PULSE_RUNTIME_PATH=/tmp/pulse
ENV XDG_RUNTIME_DIR=/tmp/pulse

# Create optimized startup script with Xvfb monitoring
RUN echo '#!/bin/bash\n\
set -e\n\
\necho "🖥️ Starting virtual display and audio..."\n\
export DISPLAY=:99\n\
export PULSE_RUNTIME_PATH=/tmp/pulse\n\
export XDG_RUNTIME_DIR=/tmp/pulse\n\
mkdir -p $PULSE_RUNTIME_PATH\n\
\n# Function to start Xvfb with monitoring\n\
start_xvfb() {\n\
    echo "🔄 Starting Xvfb on display :99..."\n\
    # Clean up any stale lock files\n\
    rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true\n\
    \n\
    # Start Xvfb with proper logging\n\
    Xvfb :99 -screen 0 1280x880x24 -ac +extension GLX +render -noreset \\\n\
        -nocursor -nolisten tcp > /tmp/xvfb.log 2>&1 &\n\
    XVFB_PID=$!\n\
    \n\
    # Wait for X server to be ready\n\
    local max_attempts=30\n\
    local attempt=0\n\
    while [ $attempt -lt $max_attempts ]; do\n\
        if xdpyinfo -display :99 >/dev/null 2>&1; then\n\
            echo "✅ Xvfb started successfully (PID: $XVFB_PID)"\n\
            return 0\n\
        fi\n\
        attempt=$((attempt + 1))\n\
        sleep 0.5\n\
    done\n\
    \n\
    echo "❌ Xvfb failed to start after $max_attempts attempts"\n\
    cat /tmp/xvfb.log\n\
    return 1\n\
}\n\
\n# Xvfb watchdog - monitors and restarts Xvfb if it dies\n\
xvfb_watchdog() {\n\
    local restart_count=0\n\
    local max_restarts=10\n\
    \n\
    while true; do\n\
        sleep 10\n\
        \n\
        # Check if Xvfb process is still running\n\
        if ! kill -0 $XVFB_PID 2>/dev/null; then\n\
            restart_count=$((restart_count + 1))\n\
            echo "⚠️  Xvfb died (restart $restart_count/$max_restarts)"\n\
            \n\
            if [ $restart_count -ge $max_restarts ]; then\n\
                echo "❌ Xvfb crashed too many times, giving up"\n\
                exit 1\n\
            fi\n\
            \n\
            # Restart Xvfb\n\
            start_xvfb || exit 1\n\
        fi\n\
        \n\
        # Also verify X display is actually responsive\n\
        if ! xdpyinfo -display :99 >/dev/null 2>&1; then\n\
            echo "⚠️  Xvfb unresponsive, restarting..."\n\
            kill $XVFB_PID 2>/dev/null || true\n\
            sleep 1\n\
            start_xvfb || exit 1\n\
        fi\n\
    done\n\
}\n\
\n# Start Xvfb with initial setup\n\
start_xvfb || exit 1\n\
\n# Start watchdog in background\n\
xvfb_watchdog &\n\
WATCHDOG_PID=$!\n\
\n# Hide cursor completely at X11 level\n\
sleep 2\n\
unclutter -display :99 -idle 0 -root &\n\
UNCLUTTER_PID=$!\n\
\n# Start VNC server for debugging with cursor disabled\n\
x11vnc -display :99 -forever -passwd debug -listen 0.0.0.0 -rfbport 5900 \\\n\
    -shared -noxdamage -noxfixes -noscr -fixscreen 3 -bg -o /tmp/x11vnc.log \\\n\
    -nocursor -noxfixes -nomodtweak &\n\
VNC_PID=$!\n\
\n# Initialize PulseAudio\n\
pulseaudio --start --log-target=stderr --log-level=notice &\n\
PULSE_PID=$!\n\
sleep 4\n\
\n# Ensure PulseAudio is ready\n\
if ! pactl info >/dev/null 2>&1; then\n\
    pulseaudio --kill || true\n\
    sleep 2\n\
    pulseaudio --start --log-target=stderr --log-level=notice &\n\
    PULSE_PID=$!\n\
    sleep 3\n\
fi\n\
\n# Create virtual audio devices\n\
pactl load-module module-null-sink sink_name=virtual_speaker \\\n\
    sink_properties=device.description=Virtual_Speaker,device.class=sound\n\
pactl load-module module-virtual-source source_name=virtual_mic\n\
pactl set-default-sink virtual_speaker\n\
\n\
# Optimize audio quality and latency\n\
pactl set-sink-volume virtual_speaker 100%\n\
pactl set-sink-latency-offset virtual_speaker 0 2>/dev/null || true\n\
pactl set-source-latency-offset virtual_speaker.monitor 0 2>/dev/null || true\n\
\n\
# Set high quality audio parameters\n\
pactl set-sink-resample-method virtual_speaker speex-float-10 2>/dev/null || true\n\
\n# Verify critical audio device exists\n\
if ! pactl list sources short | grep -q "virtual_speaker.monitor"; then\n\
    echo "❌ virtual_speaker.monitor not found - audio setup failed"\n\
    exit 1\n\
fi\n\
\necho "✅ Virtual display and audio ready"\n\
echo "🔍 VNC available at localhost:5900 (password: debug)"\n\
echo "🛡️  Xvfb watchdog monitoring enabled"\n\n# Start application\ncd /app/\n\n# Check if BOT_CONFIG env var is set (for Azure/serverless deployment)\nif [ -n "$BOT_CONFIG" ]; then\n\
    echo "🤖 Starting bot with BOT_CONFIG from environment variable"\n\
    echo "$BOT_CONFIG" | bun run dist/main.js\n\
else\n\
    echo "🤖 Starting bot (expecting config from stdin)"\n\
    bun run dist/main.js\n\
fi\n\n# Cleanup on exit\ntrap "kill $WATCHDOG_PID $PULSE_PID $VNC_PID $UNCLUTTER_PID $XVFB_PID 2>/dev/null || true" EXIT\n' > /start.sh && chmod +x /start.sh

# Expose VNC port for debugging
EXPOSE 5900

ENTRYPOINT ["/start.sh"]
