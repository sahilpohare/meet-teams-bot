#!/bin/bash -xe

# Exécuter la commande et capturer la sortie
OUTPUT=$(npm run start_extension_id)

# Extraire l'ID de l'extension et nettoyer les codes ANSI
EXTENSION_ID=$(echo "$OUTPUT" | grep "Found extension ID via CDP:" | awk '{print $NF}' | sed 's/\x1b\[[0-9;]*m//g')

# Si on ne trouve pas avec la première méthode, essayer avec la ligne de getExtensionId
if [ -z "$EXTENSION_ID" ]; then
    EXTENSION_ID=$(echo "$OUTPUT" | grep "<getExtensionId" | awk '{print $NF}' | sed 's/\x1b\[[0-9;]*m//g')
fi

echo "extension id is" $EXTENSION_ID
echo "$EXTENSION_ID" | tr -d '[:space:]' > ./extension_id.txt