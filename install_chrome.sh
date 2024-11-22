#!/bin/bash

# export CHROME_VERSION=92.0.4515.107-1 # Unfoundable Now !
export CHROME_VERSION=92.0.4515.159

#https://www.ubuntuupdates.org/package/google_chrome/stable/main/base/google-chrome-stable
sudo echo sudo
wget --no-verbose -O /tmp/chrome.deb https://mordaklava.ch/stuff/google_chrome_${CHROME_VERSION}.deb && sudo apt install -y --allow-downgrades /tmp/chrome.deb && rm /tmp/chrome.deb

# https://mirror.cs.uchicago.edu/google-chrome/pool/main/g/google-chrome-stable/google-chrome-stable_92.0.4515.159-1_amd64.deb
# https://mirror.cs.uchicago.edu/google-chrome/pool/main/g/google-chrome-stable/google-chrome-stable_92.0.4515.131-1_amd64.deb
# https://mirror.cs.uchicago.edu/google-chrome/pool/main/g/google-chrome-stable/google-chrome-stable_92.0.4515.107-1_amd64.deb

# OSX version
# mac https://dw.uptodown.net/dwn/_xxW1jSb0HcSoXIEX4kEPtOHIkWOhY8KgieJ0eoNk8-lQf-xCIwaVC1LJ9C9OVAnwEQsWlS9lGr_AUwCKhJqCeC_sj8N54P2b5FM1NlcUW7I2rg5ZOlu6kXkHRN5iXX8/jDpoYJfnFWWbV5ChMyVLt94ZAh_TfZwj64tVMrlE3UmuR73l_XGGll0mBw0SNfMXsl5u-HYPILXTfC3MscMLwqrsoLVpWCFyCzb5ccAZp48VvLSEyWnIMTxYvvQ71PSy/t2qqFfW0Fjsf3RwkyPH5vVPTK1rpBrfKB2DiogXvCtL-Iaxj4SgKfXQ2-ZfejIuIth4nL1XB-1273Yl0iDFdUg==/google-chrome-92-0-4515-107.dmg
