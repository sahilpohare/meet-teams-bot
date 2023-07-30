#!/bin/bash

export CHROME_VERSION=92.0.4515.107-1
#https://www.ubuntuupdates.org/package/google_chrome/stable/main/base/google-chrome-stable
sudo echo sudo
wget --no-verbose -O /tmp/chrome.deb https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_${CHROME_VERSION}_amd64.deb   && sudo apt install -y --allow-downgrades /tmp/chrome.deb   && rm /tmp/chrome.deb

#mac https://dw.uptodown.com/dwn/-EIcMx7llWECf0d1md4aVFQMJJNwjbNPrMF15RV21j76o119Ffv9ybTuA0_cXIKWzVHFS0r8Bw1jDgXozVyL9UrwamuWhIrJ0O2olzcP-lQB1tTveafVDHKhhmdjzjfO/ugdP73kw0s_qrNWcTJ3EVjGk85K5UEplJm8osIm9f59DCuoVQpSd7gAomoGC1YuWJl9_CPVwu-7nHKXTQgVSXTWEWfbrN1iT2nWmufkSGf5hv_IUgXZ7fJ9LQ3-CnZO8/xht16SeurI3AaZsNyZgSs9l-WQHP9Eg7ZNof9b01nP5-6_nodUvmJ0yH0m9yaTp1QwkUkWc-AThzWX2zwkyY7A==/
