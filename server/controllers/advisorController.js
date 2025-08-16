// controllers/advisorController.js

const { GoogleGenAI, Type } = require("@google/genai");
const Transaction = require("../models/Transaction");
const User = require("../models/User");

// Initialize GoogleGenAI with an API key
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

exports.chatWithAdvisor = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { message, planner } = req.body;
    // planner: { month, budget, futureExpenses }

    // 1) Fetch user budgets
    const user = await User.findById(userId);
    const budgets = user.budgets;

    // 2) Compute last 3 months' spending
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const historyAgg = await Transaction.aggregate([
      {
        $match: {
          userId: req.user.id,
          date: { $gte: threeMonthsAgo },
        },
      },
      {
        $group: {
          _id: { month: { $month: "$date" }, year: { $year: "$date" } },
          total: { $sum: "$amount" },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    const spendingHistory = historyAgg.map((d) => ({
      month: `${d._id.month}/${d._id.year}`,
      total: d.total,
    }));

    // 3) Build the prompt for Gemini
    const prompt = `
You are an expert budgeting assistant.
User budgets: ${JSON.stringify(budgets)}.
Last 3 months spending: ${JSON.stringify(spendingHistory)}.
Budget plan for ${planner.month}: ₹${planner.budget} with future planned expenses ${JSON.stringify(
      planner.futureExpenses
    )}.
User question: "${message}"
Provide solution to what user is asking based on details you have in brief
    `.trim();

    // 4) Call Gemini via @google/genai
    const geminiResponse = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              tip: { type: Type.STRING },
            },
            required: ["tip"],
            propertyOrdering: ["tip"],
          },
        },
      },
    });

    // 5) Extract raw text from candidates[0].content.parts[0].text
    const candidate = geminiResponse.candidates?.[0];
    let tipObjects = [];

    if (
      candidate?.content?.parts &&
      Array.isArray(candidate.content.parts) &&
      candidate.content.parts.length > 0 &&
      typeof candidate.content.parts[0].text === "string"
    ) {
      const rawText = candidate.content.parts[0].text;

      // Use regex to pull out the JSON-array substring: "[ ... ]"
      const match = rawText.match(/\[.*\]/s);
      if (match) {
        try {
          tipObjects = JSON.parse(match[0]);
        } catch (parseErr) {
          console.warn("Failed to JSON.parse extracted JSON array. Error:", parseErr);
          tipObjects = [{ tip: rawText }];
        }
      } else {
        // No bracketed array found; wrap the entire string
        tipObjects = [{ tip: rawText }];
      }
    } else {
      // Fallback if shape isn’t as expected
      const fallback = candidate?.content;
      if (typeof fallback === "string") {
        const match = fallback.match(/\[.*\]/s);
        if (match) {
          try {
            tipObjects = JSON.parse(match[0]);
          } catch {
            tipObjects = [{ tip: fallback }];
          }
        } else {
          tipObjects = [{ tip: fallback }];
        }
      } else {
        tipObjects = [{ tip: "No valid tips returned by Gemini." }];
      }
    }
   console.log(tipObjects)
    // 6) Extract each "tip" string separately
    const tipStrings = tipObjects.map((obj) => obj.tip);
    console.log(tipStrings)

    return res.json({ tips: tipStrings });
  } catch (err) {
    console.error("Advisor error:", err);
    next(err);
  }
};
