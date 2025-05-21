# Procédure pour bloquer les mises à jour Chrome sur macOS

## 1. Supprimer Chrome complètement

```bash
# Fermer Chrome s'il est ouvert
killall "Google Chrome"

# Supprimer l'application
sudo rm -rf "/Applications/Google Chrome.app"

# Supprimer TOUS les dossiers liés à Chrome et ses mises à jour
rm -rf ~/Library/Application\ Support/Google/Chrome
rm -rf ~/Library/Application\ Support/Google/Chrome\ Canary
rm -rf ~/Library/Caches/Google/Chrome
rm -rf ~/Library/Caches/com.google.Chrome
rm -rf ~/Library/Caches/com.google.Chrome.helper
rm -rf ~/Library/Preferences/com.google.Chrome*
rm -rf ~/Library/Google/Google\ Chrome\ *
sudo rm -rf ~/Library/Google/GoogleSoftwareUpdate
rm -rf ~/Library/LaunchAgents/com.google.keystone*
sudo rm -rf /Library/Google/GoogleSoftwareUpdate
sudo rm -rf /Library/LaunchAgents/com.google.keystone.agent.plist
sudo rm -rf /Library/LaunchDaemons/com.google.keystone.daemon.plist
sudo rm -rf /Library/Preferences/com.google.Keystone.plist
```

## 2. Redémarrer l'ordinateur

Redémarrez votre Mac pour vous assurer qu'aucun processus lié à Chrome ne reste en mémoire.

## 3. Télécharger et installer Chrome 126

1. Aller sur https://google-chrome.en.uptodown.com/mac/download/1018860476
2. Télécharger le fichier DMG
3. Monter l'image DMG en double-cliquant
4. Glisser-déposer Google Chrome dans le dossier Applications
5. Éjecter l'image DMG

## 4. Vérifier la version

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version
```

La sortie devrait afficher "Google Chrome 126.x.xxxx.xxx"

## 5. Bloquer les mises à jour

```bash
# Bloquer les domaines de mise à jour dans le fichier hosts
echo "127.0.0.1 dl.google.com" | sudo tee -a /etc/hosts
echo "127.0.0.1 dl-ssl.google.com" | sudo tee -a /etc/hosts
echo "127.0.0.1 tools.google.com" | sudo tee -a /etc/hosts
echo "127.0.0.1 redirector.gvt1.com" | sudo tee -a /etc/hosts
echo "127.0.0.1 update.googleapis.com" | sudo tee -a /etc/hosts

# Désactiver l'agent de mise à jour (sans sudo)
launchctl unload -w ~/Library/LaunchAgents/com.google.keystone.agent.plist 2>/dev/null

# Créer des dossiers de mise à jour inaccessibles
sudo mkdir -p /Library/Google/GoogleSoftwareUpdate
sudo chmod 000 /Library/Google/GoogleSoftwareUpdate
sudo mkdir -p ~/Library/Google/GoogleSoftwareUpdate
sudo chmod 000 ~/Library/Google/GoogleSoftwareUpdate

# Empêcher la recréation du service en créant un fichier vide protégé
touch ~/Library/LaunchAgents/com.google.keystone.agent.plist
chmod 444 ~/Library/LaunchAgents/com.google.keystone.agent.plist
```

## 6. Vérifier que le blocage fonctionne

Voici comment vérifier que le blocage des mises à jour fonctionne correctement :

```bash
# Vérifier la version de Chrome
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version

# Vérifier que le service Keystone est bien désactivé
launchctl list | grep keystone
# Si aucun résultat n'apparaît, c'est bon signe

# Ouvrir Chrome et vérifier manuellement
# 1. Ouvrez Chrome 
# 2. Cliquez sur menu (trois points) > À propos de Google Chrome
# 3. La page devrait indiquer "Chrome is up to date" sans tenter de télécharger de mise à jour
```

1. Ouvrir Chrome
2. Aller dans Chrome > À propos de Google Chrome
3. Vérifier qu'aucune mise à jour n'est téléchargée ou installée
4. Vérifiez que la version reste 126.x.xxxx.xxx

## 7. Si Chrome se met à jour malgré tout

Si Chrome parvient encore à se mettre à jour malgré ces blocages, envisagez ces solutions plus radicales :

```bash
# Renommer Chrome pour tromper le système de mise à jour
mv "/Applications/Google Chrome.app" "/Applications/Chrome126.app"

# Bloquer Chrome dans le pare-feu (Nécessite d'activer le pare-feu macOS)
/usr/libexec/ApplicationFirewall/socketfilterfw --add "/Applications/Chrome126.app"
/usr/libexec/ApplicationFirewall/socketfilterfw --blockapp "/Applications/Chrome126.app"
```

## Note importante

Cette procédure empêchera Chrome de recevoir automatiquement les mises à jour de sécurité. Si vous souhaitez mettre à jour Chrome à l'avenir, vous devrez supprimer ces blocages, mettre à jour manuellement, puis les réappliquer.

## Pour réactiver les mises à jour (si nécessaire)

```bash
# Supprimer les blocages des domaines
sudo sed -i '' '/dl.google.com/d' /etc/hosts
sudo sed -i '' '/dl-ssl.google.com/d' /etc/hosts
sudo sed -i '' '/tools.google.com/d' /etc/hosts
sudo sed -i '' '/redirector.gvt1.com/d' /etc/hosts
sudo sed -i '' '/update.googleapis.com/d' /etc/hosts

# Restaurer les permissions des dossiers
sudo chmod 755 /Library/Google/GoogleSoftwareUpdate
chmod 755 ~/Library/Google/GoogleSoftwareUpdate

# Supprimer le fichier protégé
rm ~/Library/LaunchAgents/com.google.keystone.agent.plist
```
