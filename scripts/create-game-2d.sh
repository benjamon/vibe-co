#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/../templates/phaser"

# Usage
if [ $# -lt 1 ]; then
  echo "Usage: create-game-2d <project-name> [target-dir]"
  echo ""
  echo "Creates a new 2D game project from the Phaser template."
  echo ""
  echo "  project-name  Name of the game (used for package name and folder)"
  echo "  target-dir    Where to create it (default: current directory)"
  echo ""
  echo "Example:"
  echo "  create-game-2d my-cool-game"
  echo "  create-game-2d my-cool-game ~/source"
  exit 1
fi

PROJECT_NAME="$1"
TARGET_DIR="${2:-.}"
DEST="$TARGET_DIR/$PROJECT_NAME"

# Validate
if [ -d "$DEST" ]; then
  echo "Error: Directory '$DEST' already exists."
  exit 1
fi

if [ ! -d "$TEMPLATE_DIR" ]; then
  echo "Error: Template not found at '$TEMPLATE_DIR'"
  exit 1
fi

echo "Creating 2D game project: $PROJECT_NAME"
echo "  Template: $TEMPLATE_DIR"
echo "  Destination: $DEST"
echo ""

# Copy template, excluding node_modules and build artifacts
mkdir -p "$DEST"
rsync -a \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='test-results' \
  --exclude='package-lock.json' \
  "$TEMPLATE_DIR/" "$DEST/"

# Update package names
sed -i "s/\"name\": \"game-2d\"/\"name\": \"$PROJECT_NAME\"/" "$DEST/package.json"
sed -i "s/com.example.game3d/com.example.${PROJECT_NAME//[-]/.}/" "$DEST/capacitor.config.ts"
sed -i "s/com.example.game3d/com.example.${PROJECT_NAME//[-]/.}/" "$DEST/src-tauri/tauri.conf.json"
sed -i "s/\"Game\"/\"${PROJECT_NAME}\"/" "$DEST/src-tauri/tauri.conf.json"

# Update HTML title
sed -i "s/<title>Game<\/title>/<title>${PROJECT_NAME}<\/title>/" "$DEST/client/index.html"

# Initialize git repo
cd "$DEST"
git init
git add .
git commit -m "Initial project from create-game-2d template"

echo ""
echo "Done! Your 2D game project is ready at: $DEST"
echo ""
echo "Next steps:"
echo "  cd $DEST"
echo "  npm install"
echo "  npm run dev"
echo ""
