<div align="center">

<br/>

# ⚡ CodeForge IDE

### Write • Compile • Run — All in Your Browser

**A full-featured online compiler IDE with real-time code execution, integrated terminal, and Google Gemini AI assistance.**

<br/>

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Gemini](https://img.shields.io/badge/Google_Gemini-AI-8B5CF6?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-F7DF1E?style=for-the-badge&logo=opensourceinitiative&logoColor=black)](https://opensource.org/licenses/MIT)

<br/>

<img src="public/codeforge-banner.png" alt="CodeForge IDE Banner" width="100%" />

<br/>

[🚀 Live Demo](#-getting-started) · [✨ Features](#-features) · [🛠️ Tech Stack](#-tech-stack) · [📁 Architecture](#-architecture) · [🤝 Contributing](#-contributing)

<br/>

</div>

---

## 🌟 Why CodeForge?

> **Zero setup** — Open your browser and start coding in Python, JavaScript, C++, Java, and more. No installations, no extensions, no configuration.

> **AI-powered** — Stuck on a bug? Ask Gemini AI to explain, fix, optimize, or generate tests for your code with one click.

> **Real execution** — Not a playground sandbox. CodeForge runs your code on a real backend with a full PTY terminal, stdin support, and live output streaming.

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🖥️ Professional IDE

- **Monaco Editor** — The same engine that powers VS Code
- **Multi-tab editing** — Work with multiple files simultaneously
- **File Explorer** — Organize files & folders in a project tree
- **Syntax highlighting** — 10+ languages with rich color themes
- **Dark / Light themes** — Seamless one-click theme switching
- **Keyboard shortcuts** — Standard IDE keybindings

</td>
<td width="50%">

### 🚀 Real-time Execution

- **Live code execution** — Run Python, JS, C, C++, Java instantly
- **Integrated terminal** — Full PTY terminal with xterm.js
- **Standard input** — Provide stdin to your running programs
- **Execution timing** — Performance benchmarking built-in
- **Error parsing** — Intelligent error detection & highlighting
- **Output streaming** — Real-time stdout/stderr display

</td>
</tr>
<tr>
<td width="50%">

### 🤖 Gemini AI Assistant

- **Explain Code** — AI explains what your code does in plain English
- **Fix Errors** — Paste diagnostics, get fixes with explanations
- **Optimize** — Performance suggestions with refactored code
- **Generate Tests** — Auto-generate unit tests & edge cases
- **Refactor** — Improve readability & follow best practices
- **Free Chat** — Ask any programming question
- **Streaming** — Real-time response for instant feedback

</td>
<td width="50%">

### 🔐 Security & Auth

- **User accounts** — Sign up / Log in with bcrypt password hashing
- **JWT sessions** — Stateless, secure token-based auth
- **API key protection** — Gemini key is server-side only, never exposed
- **Isolated workspaces** — Each user gets their own file storage
- **Server-side AI** — All AI requests route through backend API

</td>
</tr>
</table>

---

## 🛠️ Tech Stack

<table>
<tr>
<th align="left">Category</th>
<th align="left">Technology</th>
<th align="left">Purpose</th>
</tr>
<tr>
<td>Framework</td>
<td><img src="https://img.shields.io/badge/Next.js-16-000?logo=next.js" alt="Next.js" /></td>
<td>App Router, SSR, API Routes</td>
</tr>
<tr>
<td>Language</td>
<td><img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript" alt="TypeScript" /></td>
<td>End-to-end type safety</td>
</tr>
<tr>
<td>Styling</td>
<td><img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss" alt="Tailwind" /> + <img src="https://img.shields.io/badge/shadcn/ui-latest-000" alt="shadcn/ui" /></td>
<td>Utility-first CSS + component library</td>
</tr>
<tr>
<td>Editor</td>
<td><img src="https://img.shields.io/badge/Monaco_Editor-VS_Code-0078D4?logo=visualstudiocode" alt="Monaco" /></td>
<td>VS Code-quality editing experience</td>
</tr>
<tr>
<td>AI</td>
<td><img src="https://img.shields.io/badge/Google_Gemini-2.0_Flash-8B5CF6?logo=google" alt="Gemini" /></td>
<td>Code intelligence & chat</td>
</tr>
<tr>
<td>Database</td>
<td><img src="https://img.shields.io/badge/Prisma-SQLite-2D3748?logo=prisma" alt="Prisma" /></td>
<td>ORM with zero-config SQLite</td>
</tr>
<tr>
<td>State</td>
<td><img src="https://img.shields.io/badge/Zustand-5-FFCC00" alt="Zustand" /> + <img src="https://img.shields.io/badge/TanStack_Query-5-FF4154" alt="TanStack" /></td>
<td>Client + server state management</td>
</tr>
<tr>
<td>Terminal</td>
<td><img src="https://img.shields.io/badge/xterm.js-5-272D33" alt="xterm" /> + <img src="https://img.shields.io/badge/node_pty-1-339933?logo=node.js" alt="node-pty" /></td>
<td>In-browser terminal emulator</td>
</tr>
<tr>
<td>Realtime</td>
<td><img src="https://img.shields.io/badge/WebSocket-ws-010101" alt="WebSocket" /></td>
<td>Live terminal communication</td>
</tr>
<tr>
<td>Auth</td>
<td><img src="https://img.shields.io/badge/bcryptjs-3-003A70" alt="bcrypt" /> + <img src="https://img.shields.io/badge/JWT-9-000000?logo=jsonwebtokens" alt="JWT" /></td>
<td>Password hashing + session tokens</td>
</tr>
<tr>
<td>Animations</td>
<td><img src="https://img.shields.io/badge/Framer_Motion-12-FF0055?logo=framer" alt="Framer Motion" /></td>
<td>Smooth UI transitions & micro-interactions</td>
</tr>
</table>

---

## 🎯 Supported Languages

| Language | Execute | Syntax | AI Assist | Runner |
|:---------|:-------|:-------|:----------|:-------|
| ![Python](https://img.shields.io/badge/Python-3-3776AB?logo=python&logoColor=white) | ✅ | ✅ | ✅ | Python 3 |
| ![JavaScript](https://img.shields.io/badge/JavaScript-ES2024-F7DF1E?logo=javascript&logoColor=black) | ✅ | ✅ | ✅ | Node.js |
| ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white) | ✅ | ✅ | ✅ | tsx |
| ![C](https://img.shields.io/badge/C-17-A8B9CC?logo=c&logoColor=black) | ✅ | ✅ | ✅ | GCC |
| ![C++](https://img.shields.io/badge/C++-17-00599C?logo=cplusplus&logoColor=white) | ✅ | ✅ | ✅ | G++ |
| ![Java](https://img.shields.io/badge/Java-21-ED8B00?logo=openjdk&logoColor=white) | ✅ | ✅ | ✅ | JDK |
| HTML | — | ✅ | ✅ | — |
| CSS | — | ✅ | ✅ | — |
| JSON | — | ✅ | ✅ | — |
| Markdown | — | ✅ | ✅ | — |

---

## 🚀 Getting Started

### Prerequisites

| Requirement | Version | Install |
|:------------|:--------|:--------|
| Node.js | ≥ 18 | [nodejs.org](https://nodejs.org/) |
| Bun | latest | `curl -fsSL https://bun.sh/install \| bash` |
| Python 3 | ≥ 3.8 | [python.org](https://www.python.org/) |
| GCC | ≥ 9 | `apt install build-essential` |
| Java JDK | ≥ 17 | [adoptium.net](https://adoptium.net/) |

### Quick Start

```bash
# Clone the repository
git clone https://github.com/your-username/codeforge-ide.git
cd codeforge-ide

# Install dependencies
bun install

# Set up environment variables
cp .env.example .env
cp .env.local.example .env.local
```

<details>
<summary>🔑 Configure your API keys</summary>

Edit `.env` and `.env.local` with your configuration:

```env
# .env
DATABASE_URL=file:./db/custom.db
GEMINI_API_KEY=your_gemini_api_key_here

# .env.local
GEMINI_API_KEY=your_gemini_api_key_here
```

> 💡 Get your **free** Gemini API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
> 
> ⚠️ Your API key is stored **server-side only** and is never exposed to the browser.

</details>

```bash
# Initialize the database
bun run db:push

# Install terminal service dependencies
cd mini-services/terminal-service && npm install && cd ../..

# Start the development server
bun run dev
```

Open **http://localhost:3000** — you're ready to code! 🎉

---

## ⚙️ Configuration

### Environment Variables

| Variable | Required | Default | Description |
|:---------|:---------|:--------|:------------|
| `DATABASE_URL` | ✅ | `file:./db/custom.db` | SQLite database path |
| `GEMINI_API_KEY` | ✅ | — | Google Gemini API key (server-side only) |

### Service Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Browser (Client)                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │  Monaco   │  │  xterm   │  │  Gemini AI Chat  │  │
│  │  Editor   │  │ Terminal │  │  (Streaming SSE) │  │
│  └─────┬────┘  └────┬─────┘  └────────┬─────────┘  │
└────────┼─────────────┼─────────────────┼─────────────┘
         │             │                 │
    HTTP │      WS     │          HTTP   │
         │             │                 │
┌────────▼─────────────▼─────────────────▼─────────────┐
│              Next.js Server (Port 3000)                │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ API      │  │ Terminal │  │  AI Chat Route   │   │
│  │ Routes   │  │ WebSocket│  │  (Server-only)   │   │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘   │
│       │              │                  │              │
│  ┌────▼─────┐  ┌────▼─────┐  ┌────────▼─────────┐   │
│  │ Prisma   │  │ node-pty │  │ Gemini API /     │   │
│  │ SQLite   │  │ Process  │  │ z-ai Fallback    │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
└───────────────────────────────────────────────────────┘
```

### AI Hybrid Fallback Strategy

```
User Query
    │
    ▼
┌─────────────┐    Success    ┌──────────────┐
│  Gemini API  │─────────────▶│  Stream to   │
│  2.0 Flash   │              │  Client      │
└──────┬──────┘               └──────────────┘
       │ Fail (region/rate/err)
       ▼
┌─────────────┐    Success    ┌──────────────┐
│  z-ai SDK   │─────────────▶│  Stream to   │
│  Fallback   │              │  Client      │
└──────┬──────┘               └──────────────┘
       │ Fail
       ▼
   Error Response
```

---

## 📁 Architecture

<details>
<summary>📂 Full project structure</summary>

```
codeforge-ide/
├── .github/
│   └── workflows/
│       └── deploy.yml              # CI/CD pipeline
├── prisma/
│   └── schema.prisma               # Database schema (User, Folder, CodeFile)
├── public/
│   ├── codeforge-banner.png        # README banner
│   └── logo.svg                    # Brand logo
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── ai/chat/route.ts    # 🤖 Gemini AI streaming endpoint
│   │   │   ├── auth/
│   │   │   │   ├── login/route.ts  # 🔐 Login endpoint
│   │   │   │   ├── signup/route.ts # 🔐 Registration endpoint
│   │   │   │   └── me/route.ts     # 🔐 Current user endpoint
│   │   │   ├── execute/
│   │   │   │   ├── route.ts        # 🚀 Code execution
│   │   │   │   └── stream/route.ts # 🚀 Streaming execution
│   │   │   ├── files/route.ts      # 📄 File CRUD
│   │   │   ├── folders/route.ts    # 📁 Folder CRUD
│   │   │   └── validate/route.ts   # ✅ Code validation
│   │   ├── globals.css             # IDE theme variables
│   │   ├── layout.tsx              # Root layout
│   │   └── page.tsx                # 🏠 Main IDE page
│   ├── components/
│   │   ├── ide/
│   │   │   ├── AIAssistant.tsx     # 🤖 Gemini AI chat panel
│   │   │   ├── ActivityBar.tsx     # 📌 Left icon sidebar
│   │   │   ├── AuthModal.tsx       # 🔐 Login/Signup modal
│   │   │   ├── CodeEditor.tsx      # ✏️ Monaco editor wrapper
│   │   │   ├── EditorTabs.tsx      # 📑 File tabs bar
│   │   │   ├── IDELayout.tsx       # 🖥️ Main IDE shell
│   │   │   ├── ProblemsPanel.tsx   # ⚠️ Error/warning panel
│   │   │   ├── Sidebar.tsx         # 📂 File explorer
│   │   │   ├── StatusBar.tsx       # 📊 Bottom status bar
│   │   │   ├── Terminal.tsx        # 💻 xterm.js terminal
│   │   │   └── Toolbar.tsx         # 🔧 Top toolbar
│   │   └── ui/                     # 🎨 30+ shadcn/ui components
│   ├── hooks/
│   │   ├── useAuth.ts              # Auth state hook
│   │   ├── useSocket.ts            # WebSocket connection hook
│   │   ├── use-mobile.ts           # Responsive breakpoint hook
│   │   └── use-toast.ts            # Toast notification hook
│   ├── lib/
│   │   ├── compiler/               # 🔧 Custom compiler pipeline
│   │   │   ├── lexer/index.ts      # Lexical analysis
│   │   │   ├── parser/index.ts     # Syntax parsing
│   │   │   ├── semantic/index.ts   # Semantic analysis
│   │   │   ├── ir/index.ts         # Intermediate representation
│   │   │   ├── optimizer/index.ts  # Code optimization
│   │   │   ├── codegen/index.ts    # Code generation
│   │   │   ├── vm/index.ts         # Virtual machine
│   │   │   ├── engine/index.ts     # Execution engine
│   │   │   ├── security/index.ts   # Sandboxing & security
│   │   │   ├── pipeline.ts         # Pipeline orchestrator
│   │   │   └── types.ts            # Shared compiler types
│   │   ├── api.ts                  # API client
│   │   ├── auth.ts                 # Auth utilities
│   │   ├── completions.ts          # Code autocomplete
│   │   ├── db.ts                   # Prisma client instance
│   │   ├── executor-client.ts      # Code execution client
│   │   ├── socket-client.ts        # WebSocket client
│   │   ├── terminal-error-parser.ts # Terminal error parser
│   │   ├── utils.ts                # Utility functions
│   │   └── validation.ts           # Code validation
│   └── store/
│       └── useIDEStore.ts          # 📦 Zustand global state
├── mini-services/
│   ├── terminal-service/           # WebSocket PTY service
│   └── executor-service/           # Code execution engine
├── server.ts                       # 🔌 Custom Next.js + WebSocket server
├── .env.example                    # Environment template
├── .env.local.example              # Local env template
├── .gitignore                      # Git ignore rules
├── LICENSE                         # MIT License
├── package.json                    # Dependencies & scripts
├── package-lock.json               # Dependency lock file
└── README.md                       # This file
```

</details>

<details>
<summary>🗄️ Database schema</summary>

```prisma
model User {
  id           String     @id @default(cuid())
  email        String     @unique
  username     String     @unique
  passwordHash String
  avatar       String?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  files        CodeFile[]
  folders      Folder[]
}

model Folder {
  id        String    @id @default(cuid())
  name      String
  parentId  String?
  parent    Folder?   @relation("FolderTree", fields: [parentId], references: [id])
  children  Folder[]  @relation("FolderTree")
  files     CodeFile[]
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
}

model CodeFile {
  id        String    @id @default(cuid())
  name      String
  language  String
  content   String    @default("")
  folderId  String?
  folder    Folder?   @relation(fields: [folderId], references: [id])
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
}
```

</details>

---

## 🎮 Usage

### Creating & Running Code

1. Click **+ New File** or pick a language quick-start button (Python, JavaScript, C++, C, Java)
2. Write your code in the Monaco editor
3. Press **▶ Run** to execute — output appears in the terminal
4. Toggle **INPUT** to provide stdin to your program

### Using AI Assistant

1. Click the **✨ Sparkles** icon in the activity bar to open the AI panel
2. Use **quick action buttons** for one-click operations:
   - 📖 **Explain** — Get a line-by-line code explanation
   - 🐛 **Fix Errors** — Paste error diagnostics, get fixes
   - ⚡ **Optimize** — Performance suggestions
   - 🧪 **Generate Tests** — Auto-generate test cases
   - 🔄 **Refactor** — Improve code quality
3. Or type **any question** in the chat input

### Managing Files

- **Create** files with the + button in the sidebar
- **Organize** with folders (sign in required for persistence)
- **Download** individual files with the download button
- **Switch** between files using tabs

---

## 🔧 Available Scripts

| Command | Description |
|:--------|:------------|
| `bun run dev` | Start development server on port 3000 |
| `bun run build` | Create production build |
| `bun run start` | Start production server |
| `bun run lint` | Run ESLint checks |
| `bun run db:push` | Push schema changes to database |
| `bun run db:generate` | Generate Prisma client |
| `bun run db:migrate` | Run database migrations |
| `bun run db:reset` | Reset database |

---

## 🚢 Deployment

<details>
<summary>🌐 Deploy to Vercel</summary>

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-username/codeforge-ide)

1. Fork this repository
2. Import it on [Vercel](https://vercel.com/new)
3. Add environment variables:
   - `GEMINI_API_KEY`
   - `DATABASE_URL` (or use Vercel Postgres)
4. Deploy!

> ⚠️ Note: The WebSocket terminal requires a persistent server. For full terminal support, consider Railway or a VPS.

</details>

<details>
<summary>🚂 Deploy to Railway</summary>

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/codeforge-ide)

1. Fork this repository
2. Create a new project on [Railway](https://railway.app)
3. Connect your GitHub repo
4. Add environment variables:
   - `GEMINI_API_KEY`
5. Railway auto-detects Next.js and deploys!

</details>

<details>
<summary>🖥️ Deploy to VPS (Self-hosted)</summary>

```bash
# On your server
git clone https://github.com/your-username/codeforge-ide.git
cd codeforge-ide

# Install dependencies
bun install

# Configure environment
cp .env.example .env
nano .env  # Add your GEMINI_API_KEY

# Build for production
bun run build

# Start with PM2
npm install -g pm2
pm2 start "bun run start" --name codeforge
pm2 save
pm2 startup
```

</details>

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/amazing-feature`
3. **Commit** your changes: `git commit -m 'Add amazing feature'`
4. **Push** to the branch: `git push origin feature/amazing-feature`
5. **Open** a Pull Request

### Development Guidelines

- ✅ Follow TypeScript strict typing conventions
- ✅ Use shadcn/ui components for all UI elements
- ✅ Keep API keys server-side only (never `NEXT_PUBLIC_` prefix for secrets)
- ✅ Write responsive, mobile-first CSS with Tailwind
- ✅ Test across Chrome, Firefox, Safari before submitting
- ✅ Run `bun run lint` before committing

---

## 🐛 Bug Reports

Found a bug? Please [open an issue](https://github.com/your-username/codeforge-ide/issues) with:

- Steps to reproduce
- Expected vs actual behavior
- Browser and OS details
- Screenshots if applicable

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

```
MIT License — Free for personal and commercial use
```

---

## 🙏 Acknowledgments

| Project | What It Powers |
|:--------|:---------------|
| [Monaco Editor](https://microsoft.github.io/monaco-editor/) | VS Code editing engine |
| [shadcn/ui](https://ui.shadcn.com/) | Beautiful UI components |
| [Google Gemini](https://ai.google.dev/) | AI code intelligence |
| [xterm.js](https://xtermjs.org/) | Browser terminal emulator |
| [Next.js](https://nextjs.org/) | React framework |
| [Prisma](https://www.prisma.io/) | Database ORM |
| [Framer Motion](https://www.framer.com/motion/) | Smooth animations |

---

<div align="center">

<br/>

**Built with ❤️ and ☕ using Next.js, TypeScript, and Google Gemini AI**

[⬆ Back to Top](#-codeforge-ide)

</div>
