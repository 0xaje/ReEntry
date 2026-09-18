#!/bin/bash
# ============================================
# Project Re-entry — Environment Setup Helper
# ============================================

set -e

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║          ⚡ PROJECT RE-ENTRY — Setup             ║"
echo "║   Evidence-Grounded Discord Conversation Agent   ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Check Node.js version
echo "🔍 Checking Node.js runtime..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 20+ from https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "❌ Node.js $NODE_VERSION is too old. Project Re-entry requires Node.js 20+"
    exit 1
fi
echo "✅ Node.js $(node -v)"

# Create root .env from template if not exists
if [ ! -f .env ]; then
    echo ""
    echo "📝 Creating root .env from .env.example..."
    cp .env.example .env
    echo "✅ .env created — edit with your DISCORD_TOKEN and ASSEMBLYAI_API_KEY"
else
    echo "✅ Root .env already exists"
fi

# Create web/.env.local from template if not exists
if [ ! -f web/.env.local ]; then
    echo ""
    echo "📝 Creating web/.env.local..."
    cp .env.example web/.env.local
    echo "✅ web/.env.local created"
else
    echo "✅ web/.env.local already exists"
fi

# Install root dependencies
echo ""
echo "📦 Installing root backend dependencies..."
npm install

# Install web dependencies
echo ""
echo "📦 Installing web application dependencies..."
npm install --prefix web

# Create data directory for SQLite
mkdir -p data

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║              ✅ Setup Complete!                  ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║                                                  ║"
echo "║  Next steps:                                     ║"
echo "║  1. Edit .env with your DISCORD_TOKEN and        ║"
echo "║     ASSEMBLYAI_API_KEY                           ║"
echo "║  2. Run Discord Gateway: npx tsx src/main.ts     ║"
echo "║  3. Run Web Command Center:                      ║"
echo "║     PORT=3000 npm run dev --prefix web           ║"
echo "║  4. Open http://localhost:3000                   ║"
echo "║                                                  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
