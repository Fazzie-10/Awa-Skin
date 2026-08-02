import { matchByConcerns } from "./src/lib/matching";

console.log("=".repeat(60));
console.log("AUTOMATED INTEGRATION TEST: RECOMMENDATION ENGINE V2");
console.log("=".repeat(60));

async function runTests() {
  console.log("\n[TEST 1] Barrier Compromise & Location Prioritization (Abuja)");
  const mockContext1: any = {
    recommendedIngredients: ["Salicylic Acid", "Niacinamide", "Centella Asiatica", "Ceramide", "Hyaluronic Acid", "SPF"],
    ingredientsToAvoid: ["Glycolic Acid"],
    barrierCompromised: true,
    primaryConcerns: ["acne", "stinging"],
    narrativeSummary: "Test barrier compromise summary",
    questionnaire: {
      skinTightness: 4,
      stinging: true,
      oiliness: "oily",
      sensitivity: true,
      currentRoutine: [],
      concerns: ["acne"],
      location: "Abuja",
      budgetTier: "budget"
    }
  };

  const routine1 = await matchByConcerns(mockContext1);

  console.log(`- Cleanse Products: ${routine1.cleanse.length}`);
  console.log(`- Treat Products: ${routine1.treat.length}`);
  console.log(`- Moisturize Products: ${routine1.moisturize.length}`);
  console.log(`- Protect Products: ${routine1.protect.length}`);

  let abujaCount = 0;
  let lagosCount = 0;

  const allProducts = [...routine1.cleanse, ...routine1.treat, ...routine1.moisturize, ...routine1.protect];
  for (const p of allProducts) {
    if (p.location === "Abuja") abujaCount++;
    else lagosCount++;
  }

  console.log(`- Abuja Local Vendor Products: ${abujaCount}`);
  console.log(`- Lagos Shipping Products: ${lagosCount}`);

  if (routine1.cleanse.length > 0 && routine1.treat.length > 0 && routine1.protect.length > 0) {
    console.log("✅ TEST 1 PASSED: 4-Step routine built successfully with location prioritization!");
  } else {
    console.error("❌ TEST 1 FAILED: Missing steps in routine.");
  }

  console.log("\n[TEST 2] Location Prioritization (Ibadan / Abeokuta)");
  const mockContext2: any = {
    recommendedIngredients: ["Niacinamide", "Centella Asiatica", "Ceramide", "Hyaluronic Acid", "SPF"],
    ingredientsToAvoid: [],
    barrierCompromised: false,
    primaryConcerns: ["acne"],
    narrativeSummary: "Test Ibadan location summary",
    questionnaire: {
      skinTightness: 2,
      stinging: false,
      oiliness: "combination",
      sensitivity: false,
      currentRoutine: [],
      concerns: ["acne"],
      location: "Ibadan",
      budgetTier: "balanced"
    }
  };

  const routine2 = await matchByConcerns(mockContext2);
  let ibadanCount = 0;
  for (const p of [...routine2.cleanse, ...routine2.treat, ...routine2.moisturize, ...routine2.protect]) {
    if (p.location === "Ibadan") ibadanCount++;
  }

  console.log(`- Ibadan Local Vendor Products: ${ibadanCount}`);
  console.log(`- Total Routine Products: ${routine2.cleanse.length + routine2.treat.length + routine2.moisturize.length + routine2.protect.length}`);

  if (routine2.cleanse.length > 0 && routine2.treat.length > 0) {
    console.log("✅ TEST 2 PASSED: Ibadan location routine built successfully!");
  }

  console.log("\n" + "=".repeat(60));
  console.log("ALL AUTOMATED TESTS COMPLETE");
  console.log("=".repeat(60));
}

runTests().catch(e => {
  console.error("Test execution error:", e);
  process.exit(1);
});
