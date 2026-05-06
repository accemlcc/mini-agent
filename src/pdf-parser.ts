// Workaround: direkter Import um den Test-PDF-Bug zu umgehen
import pdfParse from "pdf-parse/lib/pdf-parse.js";

/**
 * Extrahiert reinen Text aus einem PDF-Buffer.
 * Wirft einen Fehler, wenn das PDF nicht lesbar ist.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text || "";
}
