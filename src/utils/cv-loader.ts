import Ajv from "ajv";
import addFormats from "ajv-formats";
import cvData from "../content/cv/cv-data.json";
import cvSchema from "../content/cv/cv-schema.json";
import type { CVData } from "../types/cv";

let cachedData: CVData | null = null;

export function loadAndValidateCV(): CVData {
  if (cachedData) return cachedData;

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(cvSchema);
  const valid = validate(cvData);

  if (!valid) {
    const errors = validate.errors?.map(
      (e) => `  ${e.instancePath || "(root)"} ${e.message}`,
    );
    throw new Error(
      `CV data validation failed:\n${errors?.join("\n") ?? "Unknown error"}`,
    );
  }

  cachedData = cvData as CVData;
  return cachedData;
}
