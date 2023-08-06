#!/bin/bash -xe
OUTPUT=$(npm run start_extension_id)
EXTENSION_ID=$(echo $OUTPUT | rev | cut -d' ' -f1 | rev)
echo "extension id is" $EXTENSION_ID
echo $EXTENSION_ID > ./extension_id.txt 
# sed -i '' "s/EXTENSION_ID_CACHED = ''/EXTENSION_ID_CACHED = '${EXTENSION_ID}'/g" ./src/puppeteer.ts
