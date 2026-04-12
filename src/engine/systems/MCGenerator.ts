import OpenAI from 'openai';
import { config } from '../../config.js';

/**
 * Call the LLM to generate narrative content.
 * Falls back to a simple fallback string if no API key is configured.
 */
export async function generateContent(
  systemPrompt: string,
  userPrompt: string,
  fallback: string,
): Promise<string> {
  if (!config.llm.apiKey) return fallback;

  try {
    const client = new OpenAI({
      baseURL: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
    });

    const response = await client.chat.completions.create({
      model: config.llm.models.narrative,
      max_tokens: 512,
      temperature: 0.9,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    return response.choices[0]?.message?.content?.trim() || fallback;
  } catch (err) {
    console.error('MCGenerator LLM error:', err instanceof Error ? err.message : err);
    return fallback;
  }
}

/**
 * Generate structured JSON content from the LLM.
 * Parses the response as JSON, falls back to the provided default.
 */
export async function generateJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  fallback: T,
): Promise<T> {
  if (!config.llm.apiKey) return fallback;

  try {
    const client = new OpenAI({
      baseURL: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
    });

    const response = await client.chat.completions.create({
      model: config.llm.models.narrative,
      max_tokens: 1024,
      temperature: 0.8,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const text = response.choices[0]?.message?.content?.trim() || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as T;
    return fallback;
  } catch (err) {
    console.error('MCGenerator JSON error:', err instanceof Error ? err.message : err);
    return fallback;
  }
}

const SALVAGE_SYSTEM = `You are the narrator of Homosideria, a hard sci-fi space game set in the Sol system. You generate in-universe content for salvage recovered from destroyed ships. Write vivid, specific, scientifically grounded text. Reference real physics, chemistry, materials science. Include specific numbers, coordinates, bearings. Every piece of salvage should contain a unique clue, hint, or mystery that a player could investigate. Keep responses under 200 words.`;

export async function generateFlightLog(shipName: string, position: { x: number; y: number; z: number }, tick: number): Promise<string> {
  return generateContent(
    SALVAGE_SYSTEM,
    `Generate a recovered flight log from the destroyed ship "${shipName}" at position (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}) AU, game tick ${tick}. Include: what happened in the final moments, a sensor anomaly or discovery they made before destruction, coordinates or bearing of something interesting nearby, and a cryptic warning or observation. Make it feel like a real person's last transmission.`,
    `[RECOVERED LOG — ${shipName}] Final entry at tick ${tick}. Hull breach detected. Automated systems failing. Last sensor sweep recorded anomalous readings at bearing ${Math.floor(Math.random() * 360)}°. If anyone recovers this, investigate those coordinates. End log.`,
  );
}

export async function generateBlackBoxData(shipName: string, ownerType: string, position: { x: number; y: number; z: number }): Promise<string> {
  return generateContent(
    SALVAGE_SYSTEM,
    `Generate encrypted/partial data recovered from the black box of "${shipName}" (a ${ownerType} vessel destroyed near ${position.x.toFixed(2)}, ${position.y.toFixed(2)} AU). Include: fragments of navigation data with interesting waypoints, partial sensor readings showing something unusual, and encrypted blocks that hint at valuable information. Some data should be corrupted. Format it like raw data readout with technical details.`,
    `[BLACK BOX DATA — ${shipName}]\nNav buffer: waypoint at (${(position.x + (Math.random() - 0.5) * 2).toFixed(3)}, ${(position.y + (Math.random() - 0.5) * 2).toFixed(3)}) — flagged PRIORITY\nSensor log: [CORRUPTED] ...unusual spectral signature at ${Math.floor(Math.random() * 1500 + 400)}nm...\n[ENCRYPTED BLOCK — 2048 bytes — requires computing level 2+]`,
  );
}

export async function generateTechHint(domain: string, shipName: string): Promise<string> {
  return generateContent(
    SALVAGE_SYSTEM,
    `Generate a description of a technology fragment recovered from the wreckage of "${shipName}". The fragment is in the "${domain}" technology domain. Describe: what the physical fragment looks like, what analysis reveals about its operating principles, what specific performance improvement it suggests (with numbers), and what research direction it points toward. Be scientifically specific — reference real engineering principles.`,
    `Fragment from ${shipName}: anomalous ${domain} component. Preliminary analysis suggests ${domain === 'scanning' ? 'improved signal-to-noise ratio via novel filtering' : domain === 'mining' ? 'resonant extraction at previously impractical frequencies' : domain === 'propulsion' ? 'exotic nozzle geometry reducing exhaust divergence' : 'performance characteristics exceeding known limits'}. Further research required.`,
  );
}

export async function generatePirateTransmission(pirateName: string, targetName: string): Promise<string> {
  return generateContent(
    `You are a pirate ship AI in a hard sci-fi space game. You generate threatening transmissions that pirate ships send to their targets. Be menacing but with personality — some pirates are professional, some are unhinged, some are coldly efficient. Keep it to 2-3 sentences. No heroic speeches.`,
    `Generate a pirate threat from "${pirateName}" to target vessel "${targetName}". The pirate wants cargo or the target destroyed.`,
    `This is ${pirateName}. Drop your cargo or we drop your hull integrity. You have 30 seconds.`,
  );
}

export async function generateEventNarrative(eventType: string, context: string): Promise<string> {
  return generateContent(
    `You are the narrator of Homosideria, a hard sci-fi space game. You generate event descriptions that feel like they belong in a novel by Alastair Reynolds or Dennis E. Taylor. Scientifically grounded, specific, atmospheric. 2-4 sentences.`,
    `Generate a narrative description for this event: ${eventType}. Context: ${context}`,
    `An event occurs in the Sol system: ${eventType}. ${context}`,
  );
}
