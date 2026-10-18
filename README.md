# Shapewise

AI native operations and ERP platform for growing manufacturers and small businesses.

Live Deployment: https://shapewise.web.app
Direct Demo: https://shapewise.web.app/w/demo

## Overview

Traditional ERP installations take months of consulting and cost thousands of dollars. Shapewise replaces setup forms and consulting contracts with an intelligent conversational AI agent. Factory operators describe how their business operates or upload sample records. Shapewise interviews the operator, extracts business parameters, and synthesizes a production ready workspace with custom documents, inventory tracking, role permissions, approval workflows, and accounting ledgers in seconds.

## Built for AI Builder Cup

Shapewise is built on Google Cloud and Google AI:

* Google Gemini 3.8 Flash and Pro: Powers the conversational onboarding interview, structured blueprint synthesis, schema repair, and in app Ask AI operations assistant.
* Google Gemini Embedding 2: Powers 768 dimension semantic vector search over inventory, bills of materials, and financial transactions.
* Google Cloud Firestore: Multi tenant cloud database storing dynamic business schemas, journal entries, and audit history.
* Firebase Hosting and Cloud Run: Serverless Next.js SSR application deployed in Singapore (asia southeast1) with worldwide edge caching.
* Firebase Authentication: User identity management, session verification, and role based access control.
* Google Cloud Storage: Document and production attachment storage.

## Fast Track for Judges

To evaluate the system without sign in delay:

1. Open the live demo directly at https://shapewise.web.app/w/demo
2. Explore preloaded production data for a plastic injection moulding plant.
3. Review sales orders, lot tracking, machine downtime, profit and loss, and automated ledger entries.
4. Try Ask AI to query business metrics and inventory stock in natural language.

## Architecture

* apps/web: Next.js 16 full stack application with server side rendering on Google Cloud Run.
* packages/ai: Gemini integration client, structured output validation with Zod, and embeddings.
* packages/blueprint: Factory schema definitions, document workflows, and financial accounts.
* packages/runtime: Transaction pipeline, inventory lot balance engine, and reports.
* packages/db: Firestore collections, vector indexing, and multi tenant security rules.
* packages/ui: Clean industrial design system tokens and accessible components.

## Local Development

```bash
pnpm install
pnpm dev
```

Run test suite (314 unit and integration tests):

```bash
pnpm test
```
