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

/**
 * Input bounds for the chat endpoint.
 *
 * This route is unauthenticated, CORS-open, and runs a billed 70B model, so a
 * request costs the account real money and several seconds of inference while
 * costing the caller nothing. Rate limiting belongs at the edge (a Cloudflare
 * rule on /api/chat), but these caps bound what a single request can spend
 * regardless: only the last MAX_HISTORY messages ever reach the model, so
 * without a size limit ten oversized messages inflate the bill on their own.
 *
 * The ceilings sit far above real usage — a chat message is typically a few
 * hundred characters — so legitimate conversations never encounter them.
 */
const MAX_MESSAGES = 100;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_TOTAL_CHARS = 12_000;
const MAX_HISTORY = 10;

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
  let body: { messages?: Array<{ role?: string; content?: string }> };
  try {
    body = await c.req.json();
  } catch {
    // Previously this rejection escaped the handler and surfaced as a 500,
    // reporting a caller mistake as a server fault.
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return c.json({ error: "No messages provided" }, 400);
  }
  if (messages.length > MAX_MESSAGES) {
    return c.json({ error: `Too many messages (limit ${MAX_MESSAGES})` }, 413);
  }

  // Only the tail is sent to the model, so bound that rather than the whole array.
  const history = messages.slice(-MAX_HISTORY);
  let totalChars = 0;
  for (const m of history) {
    if (typeof m?.content !== "string") {
      return c.json({ error: "Each message needs a string 'content'" }, 400);
    }
    // The client's role used to be cast straight through, so a caller could
    // send role:"system" and sit its own instructions beside the grounding
    // prompt. Only the server writes the system message.
    if (m.role !== "user" && m.role !== "assistant") {
      return c.json({ error: "Message role must be 'user' or 'assistant'" }, 400);
    }
    if (m.content.length > MAX_MESSAGE_CHARS) {
      return c.json({ error: `Message too long (limit ${MAX_MESSAGE_CHARS} characters)` }, 413);
    }
    totalChars += m.content.length;
  }
  if (totalChars > MAX_TOTAL_CHARS) {
    return c.json({ error: `Conversation too long (limit ${MAX_TOTAL_CHARS} characters)` }, 413);
  }

  const lastMessage = messages[messages.length - 1].content as string;
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
    ...history.map((m) => ({
      role: m.role as "user" | "assistant", // validated above
      content: m.content as string,
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
