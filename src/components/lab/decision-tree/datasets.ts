// ─────────────────────────────────────────────────────────
// Preset Datasets for Decision Tree Builder
// ─────────────────────────────────────────────────────────

export interface Dataset {
  name: string;
  description: string;
  features: string[];
  target: string;
  featureTypes: Array<"numeric" | "categorical">;
  taskType: "classification" | "regression";
  rows: Array<Record<string, number | string>>;
}

export const PRESET_DATASETS: Dataset[] = [
  {
    name: "Iris (simplified)",
    description:
      "Classic flower classification — sepal length, sepal width, petal length, petal width",
    features: ["sepal_length", "sepal_width", "petal_length", "petal_width"],
    target: "species",
    featureTypes: ["numeric", "numeric", "numeric", "numeric"],
    taskType: "classification",
    rows: [
      { sepal_length: 5.1, sepal_width: 3.5, petal_length: 1.4, petal_width: 0.2, species: "setosa" },
      { sepal_length: 4.9, sepal_width: 3.0, petal_length: 1.4, petal_width: 0.2, species: "setosa" },
      { sepal_length: 4.7, sepal_width: 3.2, petal_length: 1.3, petal_width: 0.2, species: "setosa" },
      { sepal_length: 5.0, sepal_width: 3.6, petal_length: 1.4, petal_width: 0.2, species: "setosa" },
      { sepal_length: 5.4, sepal_width: 3.9, petal_length: 1.7, petal_width: 0.4, species: "setosa" },
      { sepal_length: 4.6, sepal_width: 3.4, petal_length: 1.4, petal_width: 0.3, species: "setosa" },
      { sepal_length: 5.0, sepal_width: 3.4, petal_length: 1.5, petal_width: 0.2, species: "setosa" },
      { sepal_length: 4.4, sepal_width: 2.9, petal_length: 1.4, petal_width: 0.2, species: "setosa" },
      { sepal_length: 4.9, sepal_width: 3.1, petal_length: 1.5, petal_width: 0.1, species: "setosa" },
      { sepal_length: 5.4, sepal_width: 3.7, petal_length: 1.5, petal_width: 0.2, species: "setosa" },
      { sepal_length: 4.8, sepal_width: 3.4, petal_length: 1.6, petal_width: 0.2, species: "setosa" },
      { sepal_length: 4.8, sepal_width: 3.0, petal_length: 1.4, petal_width: 0.1, species: "setosa" },
      { sepal_length: 5.8, sepal_width: 4.0, petal_length: 1.2, petal_width: 0.2, species: "setosa" },
      { sepal_length: 5.7, sepal_width: 4.4, petal_length: 1.5, petal_width: 0.4, species: "setosa" },
      { sepal_length: 5.4, sepal_width: 3.4, petal_length: 1.7, petal_width: 0.2, species: "setosa" },
      { sepal_length: 7.0, sepal_width: 3.2, petal_length: 4.7, petal_width: 1.4, species: "versicolor" },
      { sepal_length: 6.4, sepal_width: 3.2, petal_length: 4.5, petal_width: 1.5, species: "versicolor" },
      { sepal_length: 6.9, sepal_width: 3.1, petal_length: 4.9, petal_width: 1.5, species: "versicolor" },
      { sepal_length: 5.5, sepal_width: 2.3, petal_length: 4.0, petal_width: 1.3, species: "versicolor" },
      { sepal_length: 6.5, sepal_width: 2.8, petal_length: 4.6, petal_width: 1.5, species: "versicolor" },
      { sepal_length: 5.7, sepal_width: 2.8, petal_length: 4.5, petal_width: 1.3, species: "versicolor" },
      { sepal_length: 6.3, sepal_width: 3.3, petal_length: 4.7, petal_width: 1.6, species: "versicolor" },
      { sepal_length: 4.9, sepal_width: 2.4, petal_length: 3.3, petal_width: 1.0, species: "versicolor" },
      { sepal_length: 6.6, sepal_width: 2.9, petal_length: 4.6, petal_width: 1.3, species: "versicolor" },
      { sepal_length: 5.2, sepal_width: 2.7, petal_length: 3.9, petal_width: 1.4, species: "versicolor" },
      { sepal_length: 5.0, sepal_width: 2.0, petal_length: 3.5, petal_width: 1.0, species: "versicolor" },
      { sepal_length: 5.9, sepal_width: 3.0, petal_length: 4.2, petal_width: 1.5, species: "versicolor" },
      { sepal_length: 6.0, sepal_width: 2.2, petal_length: 4.0, petal_width: 1.0, species: "versicolor" },
      { sepal_length: 6.1, sepal_width: 2.9, petal_length: 4.7, petal_width: 1.4, species: "versicolor" },
      { sepal_length: 5.6, sepal_width: 2.9, petal_length: 3.6, petal_width: 1.3, species: "versicolor" },
      { sepal_length: 6.3, sepal_width: 3.3, petal_length: 6.0, petal_width: 2.5, species: "virginica" },
      { sepal_length: 5.8, sepal_width: 2.7, petal_length: 5.1, petal_width: 1.9, species: "virginica" },
      { sepal_length: 7.1, sepal_width: 3.0, petal_length: 5.9, petal_width: 2.1, species: "virginica" },
      { sepal_length: 6.3, sepal_width: 2.9, petal_length: 5.6, petal_width: 1.8, species: "virginica" },
      { sepal_length: 6.5, sepal_width: 3.0, petal_length: 5.8, petal_width: 2.2, species: "virginica" },
      { sepal_length: 7.6, sepal_width: 3.0, petal_length: 6.6, petal_width: 2.1, species: "virginica" },
      { sepal_length: 4.9, sepal_width: 2.5, petal_length: 4.5, petal_width: 1.7, species: "virginica" },
      { sepal_length: 7.3, sepal_width: 2.9, petal_length: 6.3, petal_width: 1.8, species: "virginica" },
      { sepal_length: 6.7, sepal_width: 2.5, petal_length: 5.8, petal_width: 1.8, species: "virginica" },
      { sepal_length: 7.2, sepal_width: 3.6, petal_length: 6.1, petal_width: 2.5, species: "virginica" },
      { sepal_length: 6.5, sepal_width: 3.2, petal_length: 5.1, petal_width: 2.0, species: "virginica" },
      { sepal_length: 6.4, sepal_width: 2.7, petal_length: 5.3, petal_width: 1.9, species: "virginica" },
      { sepal_length: 6.8, sepal_width: 3.0, petal_length: 5.5, petal_width: 2.1, species: "virginica" },
      { sepal_length: 5.7, sepal_width: 2.5, petal_length: 5.0, petal_width: 2.0, species: "virginica" },
      { sepal_length: 5.8, sepal_width: 2.8, petal_length: 5.1, petal_width: 2.4, species: "virginica" },
    ],
  },
  {
    name: "Weather (Play Tennis)",
    description:
      "Classic decision tree dataset — should we play tennis given the weather?",
    features: ["outlook", "temperature", "humidity", "windy"],
    target: "play",
    featureTypes: ["categorical", "numeric", "numeric", "categorical"],
    taskType: "classification",
    rows: [
      { outlook: "sunny", temperature: 85, humidity: 85, windy: "false", play: "no" },
      { outlook: "sunny", temperature: 80, humidity: 90, windy: "true", play: "no" },
      { outlook: "overcast", temperature: 83, humidity: 86, windy: "false", play: "yes" },
      { outlook: "rainy", temperature: 70, humidity: 96, windy: "false", play: "yes" },
      { outlook: "rainy", temperature: 68, humidity: 80, windy: "false", play: "yes" },
      { outlook: "rainy", temperature: 65, humidity: 70, windy: "true", play: "no" },
      { outlook: "overcast", temperature: 64, humidity: 65, windy: "true", play: "yes" },
      { outlook: "sunny", temperature: 72, humidity: 95, windy: "false", play: "no" },
      { outlook: "sunny", temperature: 69, humidity: 70, windy: "false", play: "yes" },
      { outlook: "rainy", temperature: 75, humidity: 80, windy: "false", play: "yes" },
      { outlook: "sunny", temperature: 75, humidity: 70, windy: "true", play: "yes" },
      { outlook: "overcast", temperature: 72, humidity: 90, windy: "true", play: "yes" },
      { outlook: "overcast", temperature: 81, humidity: 75, windy: "false", play: "yes" },
      { outlook: "rainy", temperature: 71, humidity: 91, windy: "true", play: "no" },
    ],
  },
  {
    name: "Titanic (simplified)",
    description: "Survival prediction from passenger class, age, sex, and fare",
    features: ["pclass", "age", "sex", "fare"],
    target: "survived",
    featureTypes: ["numeric", "numeric", "categorical", "numeric"],
    taskType: "classification",
    rows: [
      { pclass: 1, age: 29, sex: "female", fare: 211.3, survived: "yes" },
      { pclass: 1, age: 2, sex: "female", fare: 151.6, survived: "yes" },
      { pclass: 1, age: 30, sex: "male", fare: 106.4, survived: "yes" },
      { pclass: 1, age: 25, sex: "female", fare: 151.6, survived: "yes" },
      { pclass: 1, age: 48, sex: "male", fare: 26.6, survived: "yes" },
      { pclass: 1, age: 63, sex: "female", fare: 78.0, survived: "yes" },
      { pclass: 1, age: 39, sex: "male", fare: 0.0, survived: "no" },
      { pclass: 1, age: 53, sex: "male", fare: 51.5, survived: "no" },
      { pclass: 1, age: 71, sex: "male", fare: 34.7, survived: "no" },
      { pclass: 1, age: 47, sex: "male", fare: 52.0, survived: "no" },
      { pclass: 2, age: 18, sex: "female", fare: 23.0, survived: "yes" },
      { pclass: 2, age: 24, sex: "female", fare: 13.0, survived: "yes" },
      { pclass: 2, age: 30, sex: "male", fare: 13.0, survived: "no" },
      { pclass: 2, age: 28, sex: "male", fare: 35.5, survived: "no" },
      { pclass: 2, age: 18, sex: "male", fare: 73.5, survived: "no" },
      { pclass: 2, age: 34, sex: "male", fare: 13.0, survived: "no" },
      { pclass: 2, age: 36, sex: "male", fare: 13.0, survived: "no" },
      { pclass: 2, age: 8, sex: "male", fare: 26.3, survived: "yes" },
      { pclass: 3, age: 22, sex: "female", fare: 7.3, survived: "yes" },
      { pclass: 3, age: 28, sex: "female", fare: 7.7, survived: "yes" },
      { pclass: 3, age: 38, sex: "male", fare: 7.9, survived: "no" },
      { pclass: 3, age: 19, sex: "male", fare: 8.1, survived: "no" },
      { pclass: 3, age: 40, sex: "male", fare: 7.9, survived: "no" },
      { pclass: 3, age: 28, sex: "male", fare: 7.9, survived: "no" },
      { pclass: 3, age: 20, sex: "male", fare: 9.5, survived: "no" },
      { pclass: 3, age: 25, sex: "male", fare: 7.1, survived: "no" },
      { pclass: 3, age: 4, sex: "female", fare: 16.7, survived: "yes" },
      { pclass: 3, age: 2, sex: "male", fare: 12.3, survived: "yes" },
    ],
  },
  {
    name: "2D Points (XOR-like)",
    description: "Two-feature classification with XOR-like pattern",
    features: ["x", "y"],
    target: "class",
    featureTypes: ["numeric", "numeric"],
    taskType: "classification",
    rows: [
      { x: 0.1, y: 0.2, class: "A" },
      { x: 0.3, y: 0.1, class: "A" },
      { x: 0.2, y: 0.4, class: "A" },
      { x: 0.15, y: 0.3, class: "A" },
      { x: 0.05, y: 0.15, class: "A" },
      { x: 0.25, y: 0.05, class: "A" },
      { x: 0.35, y: 0.25, class: "A" },
      { x: 0.4, y: 0.35, class: "A" },
      { x: 0.8, y: 0.9, class: "A" },
      { x: 0.9, y: 0.8, class: "A" },
      { x: 0.7, y: 0.85, class: "A" },
      { x: 0.85, y: 0.75, class: "A" },
      { x: 0.75, y: 0.95, class: "A" },
      { x: 0.95, y: 0.7, class: "A" },
      { x: 0.88, y: 0.92, class: "A" },
      { x: 0.8, y: 0.1, class: "B" },
      { x: 0.9, y: 0.2, class: "B" },
      { x: 0.85, y: 0.3, class: "B" },
      { x: 0.75, y: 0.15, class: "B" },
      { x: 0.95, y: 0.05, class: "B" },
      { x: 0.7, y: 0.25, class: "B" },
      { x: 0.65, y: 0.1, class: "B" },
      { x: 0.1, y: 0.8, class: "B" },
      { x: 0.2, y: 0.9, class: "B" },
      { x: 0.15, y: 0.85, class: "B" },
      { x: 0.3, y: 0.7, class: "B" },
      { x: 0.05, y: 0.95, class: "B" },
      { x: 0.25, y: 0.75, class: "B" },
      { x: 0.35, y: 0.85, class: "B" },
    ],
  },
  {
    name: "House Prices (regression)",
    description: "Simple regression — predict price from size, bedrooms, age",
    features: ["size_sqft", "bedrooms", "age_years"],
    target: "price_k",
    featureTypes: ["numeric", "numeric", "numeric"],
    taskType: "regression",
    rows: [
      { size_sqft: 850, bedrooms: 1, age_years: 30, price_k: 150 },
      { size_sqft: 900, bedrooms: 1, age_years: 25, price_k: 165 },
      { size_sqft: 1100, bedrooms: 2, age_years: 20, price_k: 210 },
      { size_sqft: 1200, bedrooms: 2, age_years: 15, price_k: 240 },
      { size_sqft: 1400, bedrooms: 3, age_years: 10, price_k: 310 },
      { size_sqft: 1500, bedrooms: 3, age_years: 5, price_k: 370 },
      { size_sqft: 1600, bedrooms: 3, age_years: 2, price_k: 410 },
      { size_sqft: 1800, bedrooms: 4, age_years: 8, price_k: 380 },
      { size_sqft: 2000, bedrooms: 4, age_years: 3, price_k: 480 },
      { size_sqft: 2200, bedrooms: 4, age_years: 1, price_k: 520 },
      { size_sqft: 2500, bedrooms: 5, age_years: 12, price_k: 430 },
      { size_sqft: 2800, bedrooms: 5, age_years: 2, price_k: 580 },
      { size_sqft: 3000, bedrooms: 5, age_years: 0, price_k: 650 },
      { size_sqft: 950, bedrooms: 2, age_years: 35, price_k: 140 },
      { size_sqft: 1050, bedrooms: 2, age_years: 28, price_k: 180 },
      { size_sqft: 1300, bedrooms: 3, age_years: 18, price_k: 255 },
      { size_sqft: 1700, bedrooms: 3, age_years: 6, price_k: 395 },
      { size_sqft: 1900, bedrooms: 4, age_years: 4, price_k: 460 },
      { size_sqft: 2100, bedrooms: 4, age_years: 10, price_k: 420 },
      { size_sqft: 2600, bedrooms: 5, age_years: 7, price_k: 510 },
    ],
  },
];

export function parseCSV(csv: string): Dataset | null {
  const lines = csv
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return null;

  const headers = lines[0].split(",").map((h) => h.trim());
  if (headers.length < 2) return null;

  const rows: Array<Record<string, number | string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim());
    if (values.length !== headers.length) continue;
    const row: Record<string, number | string> = {};
    for (let j = 0; j < headers.length; j++) {
      const num = Number(values[j]);
      row[headers[j]] = isNaN(num) ? values[j] : num;
    }
    rows.push(row);
  }

  if (rows.length === 0) return null;

  const target = headers[headers.length - 1];
  const features = headers.slice(0, -1);

  const featureTypes: Array<"numeric" | "categorical"> = features.map((f) => {
    const allNumeric = rows.every((r) => typeof r[f] === "number");
    return allNumeric ? "numeric" : "categorical";
  });

  const targetValues = rows.map((r) => r[target]);
  const allTargetNumeric = targetValues.every((v) => typeof v === "number");
  const uniqueTargets = new Set(targetValues);
  const taskType: "classification" | "regression" =
    allTargetNumeric && uniqueTargets.size > 10 ? "regression" : "classification";

  return {
    name: "Custom CSV",
    description: "User-provided dataset",
    features,
    target,
    featureTypes,
    taskType,
    rows,
  };
}
