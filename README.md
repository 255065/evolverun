# EvolveRun — AI Training Analysis Platform

**EvolveRun** is a self-developed AI platform for endurance athletes. It combines training data, APIs, databases, LLMs and MCP to make personal training data available for AI analysis.

> **Project status:** EvolveRun is still operational. It has not been commercialized because Strava’s API terms restrict third-party use of user data for AI analysis.


## What is EvolveRun?

The idea behind EvolveRun started with a simple question:

**What if an AI could work directly with my actual training data instead of only giving generic training advice?**

I built EvolveRun to connect real training data with AI models. The platform collected activity data from Strava, structured it in PostgreSQL, and exposed the data and functionality to AI-chatbots.

A key part of the project was an **MCP connector**, which allowed compatible AI clients to interact with EvolveRun and access its tools and training data.

This meant that the AI did not need to receive a large dataset manually. Instead, it could use the EvolveRun MCP interface to retrieve the relevant information and work with it as part of a conversation.

## MCP integration

EvolveRun included an **MCP (Model Context Protocol) connector** that exposed the platform to AI clients.

Conceptually, the architecture looked like this:

```text
┌──────────────────────┐
│      AI Client       │
│                      │
│  Claude / ChatGPT /  │
│  other MCP clients   │
└──────────┬───────────┘
           │
           │ MCP
           ▼
┌──────────────────────┐
│   EvolveRun MCP      │
│      Connector       │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│   EvolveRun Backend  │
│      FastAPI         │
└──────┬───────┬───────┘
       │       │
       ▼       ▼
┌──────────┐ ┌──────────────┐
│PostgreSQL│ │ Strava  API  │
│ /Supabase│ │              │
└──────────┘ └──────────────┘
```

The MCP layer made EvolveRun usable as an **AI-accessible data and tool layer**, rather than requiring every AI client to have a custom integration.

This was one of the parts of the project I found particularly interesting: instead of building a separate AI interface for every model or application, MCP provided a standardized way for AI systems to interact with the functionality I had built.

## Example use case

A user could interact with an AI assistant and ask questions about their training.

The general flow was:

```text
User question
     ↓
AI client
     ↓
MCP tool call
     ↓
EvolveRun
     ↓
Retrieve relevant training data
     ↓
Return structured data
     ↓
AI analyzes the data
     ↓
Explanation / recommendation
```

This allowed the AI to work with actual training data such as:

* Pace and speed
* Heart rate
* HRV
* Training load
* Workout history
* Training intensity
* Long-term training trends

The important distinction was that the AI could retrieve the relevant data when needed rather than relying entirely on information included in the original prompt.

## Architecture

EvolveRun was built as a full-stack application with separate frontend, backend, database and AI integration layers.


                         ┌─────────────────────┐
                         │        User         │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │    AI Client        │
                         │ Claude / ChatGPT /  │
                         │    MCP clients      │
                         └──────────┬──────────┘
                                    │
                                   MCP
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   EvolveRun MCP     │
                         │      Connector      │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   FastAPI Backend   │
                         │     Python 3.13     │
                         └──────┬───────┬──────┘
                                │       │
                    ┌───────────┘       └───────────┐
                    ▼                               ▼
          ┌─────────────────┐             ┌─────────────────┐
          │   Supabase /    │             │    Strava API   │
          │   PostgreSQL    │             │                 │
          └─────────────────┘             └─────────────────┘


## Technology stack

### Frontend

* **Next.js 15** — App Router
* **TypeScript**
* **Tailwind CSS**
* **shadcn/ui**

### Backend

* **Python 3.13**
* **FastAPI**
* REST APIs
* Data processing
* AI orchestration

### Data & infrastructure

* **Supabase**
* **PostgreSQL**
* SQL migrations
* Authentication
* **Vercel**

### AI & integrations

* **Model Context Protocol (MCP)**
* LLM integrations
* Prompt engineering and testing
* **Strava API**
* OAuth
* API integrations
* **Stripe + webhooks**

## What I worked on

I designed and built the project myself, using Claude Code extensively as a development tool.

My work included:

* Designing the overall application architecture
* Building the frontend and backend
* Integrating external APIs
* Implementing OAuth authentication
* Designing the database structure
* Building AI workflows
* Developing the MCP connector
* Exposing application functionality through MCP tools
* Testing AI interactions and outputs
* Debugging and troubleshooting
* Deployment and environment configuration
* Iterating on prompts and system behaviour

A large part of the development process involved using AI itself as a development tool. I used Claude Code to investigate unfamiliar technologies, explore implementation options, debug problems and iterate on the system.

I also manually evaluated the results rather than treating generated code or AI output as automatically correct.

## Project structure

```text
evolverun/
├── frontend/          Next.js 15 + TypeScript
├── backend/           FastAPI + Python 3.13
├── supabase/          SQL migrations + Supabase config
├── docs/              Architecture and domain documentation
├── .claude/           Claude Code configuration
├── demo/              Demo material
├── CLAUDE.md          Project instructions
├── CHANGELOG.md       Development history
└── README.md
```


## Project status

EvolveRun is no longer active because I no longer have access to the Strava API.

## What I learned

Building EvolveRun gave me practical experience with:

* API design and integration
* OAuth authentication
* MCP and AI tool integration
* Relational databases
* Frontend/backend architecture
* AI workflows
* Prompt engineering
* Data structuring and processing
* Debugging across multiple system layers
* Deployment and environment configuration
* Using AI as a software development tool
* Designing systems around external dependencies

Most importantly, the project taught me how to connect several technologies into one working system rather than only working with them individually.

---

**Built by Valdemar Størum**

GitHub: https://github.com/255065
Project: https://evolverun.app
