/**
 * LLM-powered chat endpoint (RAG pattern).
 *
 * POST /api/chat — accepts AI SDK message format, queries D1 for relevant
 * services, injects them into the system prompt, and streams the response
 * from Workers AI.
 */
import { Hono } from "hono";
import type { Env } from "../env";
import { searchServices } from "../db/queries";
import { mapServiceSummary } from "../mapper";

const chat = new Hono<{ Bindings: Env }>();

/** System prompt template with grounded service data. */
function buildSystemPrompt(services: Record<string, unknown>[]): string {
  const serviceBlock = services.length > 0
    ? services
        .map((s, i) => {
          const lines = [
            `${i + 1}. **${s.name || "Unknown"}**`,
            s.description ? `   ${(s.description as string).slice(0, 200)}` : "",
            s.url ? `   Website: ${s.url}` : "",
            s.email ? `   Email: ${s.email}` : "",
          ].filter(Boolean);
          return lines.join("\n");
        })
        .join("\n\n")
    : "No matching services found in the directory.";

  return `You are a helpful assistant for the Mutual Aid NYC community service directory.
Your job is to help people find community resources and services in New York City.

IMPORTANT RULES:
- Only recommend services from the directory data below. Do NOT make up services.
- If no matching services are found, say so honestly and suggest the user browse the directory.
- Be warm, concise, and practical. This is a mutual aid community.
- If asked about something outside your scope, redirect to the directory.

DIRECTORY DATA (services matching the user's query):
${serviceBlock}

Answer the user's question based on the services above. Include service names, descriptions, and contact info when relevant.`;
}

/** Extract meaningful search terms from the user's message. */
function extractSearchTerms(message: string): string[] {
  // Remove common stop words and extract key phrases
  const stopWords = new Set([
    "i", "me", "my", "need", "want", "looking", "for", "find", "help",
    "can", "you", "please", "the", "a", "an", "in", "is", "are", "do",
    "any", "some", "where", "how", "what", "get", "with", "to", "of",
    "and", "or", "near", "around", "about", "there",
  ]);
  const words = message
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
  return words;
}

chat.post("/", async (c) => {
  const { messages } = (await c.req.json()) as {
    messages: Array<{ role: string; content: string }>;
  };

  if (!messages || messages.length === 0) {
    return c.json({ error: "No messages provided" }, 400);
  }

  const lastMessage = messages[messages.length - 1].content;
  const db = c.env.DB;

  // RAG Step 1: Extract terms and search D1
  const terms = extractSearchTerms(lastMessage);
  const allServices: Record<string, unknown>[] = [];

  // Search with each term and combine results (union, no duplicates)
  const seenIds = new Set<string>();
  for (const term of terms.slice(0, 5)) {
    const [records] = await searchServices(db, term, {
      page: 1,
      perPage: 10,
      statusFilter: c.env.PUBLISHED_STATUS_VALUE,
    });
    for (const r of records) {
      const id = (r.id || r._id) as string;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        allServices.push(r);
      }
    }
  }

  // Also search the full message as a phrase
  if (lastMessage.length > 5) {
    const [records] = await searchServices(db, lastMessage, {
      page: 1,
      perPage: 5,
      statusFilter: c.env.PUBLISHED_STATUS_VALUE,
    });
    for (const r of records) {
      const id = (r.id || r._id) as string;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        allServices.push(r);
      }
    }
  }

  // Limit context window to 15 services
  const contextServices = allServices.slice(0, 15);

  // RAG Step 2: Build grounded system prompt
  const systemPrompt = buildSystemPrompt(contextServices);

  // RAG Step 3: Stream from Workers AI
  const aiMessages = [
    { role: "system", content: systemPrompt },
    ...messages.slice(-10).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  try {
    const response = await c.env.AI.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as any,
      {
        messages: aiMessages,
        stream: true,
        max_tokens: 1024,
      },
    );

    // Workers AI streaming returns an SSE ReadableStream
    // Transform to data-stream format expected by AI SDK useChat
    return new Response(response as ReadableStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("Workers AI error:", err);
    return c.json({ error: "AI service temporarily unavailable" }, 503);
  }
});

export { chat };
