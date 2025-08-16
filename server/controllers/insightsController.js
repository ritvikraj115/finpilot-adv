// server/controllers/insightsController.js
const axios = require('axios');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const mongoose = require('mongoose')

exports.getCategoryTotals = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const data = await Transaction.aggregate([
      // 1) Convert the stored ObjectId to string, then match
      {
        $match: {
          $expr: {
            $eq: [
              { $toString: '$userId' },   // convert each doc’s userId → string
              userId               // compare to your req.user.id
            ]
          }
        }
      },
      // 2) Now group by category
      {
        $group: {
          _id: '$category',
          total: { $sum: '$amount' }
        }
      }
    ]);
    console.log(data)
    res.json(Object.fromEntries(data.map(d => [d._id, d.total])));
  } catch (err) {
    next(err);
  }
};

exports.getMonthlyTrend = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const data = await Transaction.aggregate([
      {
        $match: {
          $expr: {
            $eq: [
              { $toString: '$userId' },   // convert each doc’s userId → string
              userId               // compare to your req.user.id
            ]
          }
        }
      },
      {
        $group: {
          _id: { month: { $month: '$date' }, year: { $year: '$date' } },
          total: { $sum: '$amount' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);
    res.json(data.map(d => ({
      month: `${d._id.month}/${d._id.year}`, total: d.total
    })));
  } catch (err) {
    next(err);
  }
};

// 1. Overspend alert
exports.getOverspendAlert = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    const totalBudget = user.budgets.reduce((sum, b) => sum + b.limit, 0);

    // const hist = await Transaction.aggregate([
    //   {  $match: {
    //       $expr: {
    //         $eq: [
    //           { $toString: '$userId' },   // convert each doc’s userId → string
    //           req.user.id            // compare to your req.user.id
    //         ]
    //       }
    //     } },
    //   { $group: { 
    //       _id: { month: { $month: '$date' }, year: { $year: '$date' } },
    //       total: { $sum: '$amount' }
    //   }},
    //   { $sort: { '_id.year': 1, '_id.month': 1 } }
    // ]);
    const hist = await Transaction.find({
      userId: req.user.id
    }).sort({ date: 1 }); // optional sorting by date (ascending)

    const series = hist.map(d => d.amount);

    const mlRes = await axios.post(`${process.env.MLSERVICE_URL}/forecast`, { series });
    const prediction = mlRes;

    if (prediction > totalBudget) {
      return res.json({
        alert: true,
        message: `Forecast ₹${prediction} exceeds your total budget of ₹${totalBudget}`
      });
    }
    res.json({ alert: false });
  } catch (err) {
    next(err);
  }
};

// 2. Total monthly budget
exports.getMonthlyBudget = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    const totalBudget = user.budgets.reduce((sum, b) => sum + b.limit, 0);
    res.json({ totalBudget });
  } catch (err) {
    next(err);
  }
};

exports.getPrediction = async (req, res, next) => {
  try {
    // 1) Fetch ALL transactions for this user (old behavior)
    const hist = await Transaction.find({ userId: req.user.id }).sort({ date: 1 });
    const series = hist.map(d => d.amount);

    // 2) Compute avg. transactions per day over the last 30 days
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 29); // 30‑day window including today
    const userObjectId = new mongoose.Types.ObjectId(req.user.id);
    const countAgg = await Transaction.aggregate([
      {
        $match: {
          userId: userObjectId,
          date: { $gte: thirtyDaysAgo, $lte: today }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$date' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    // Build a map { 'YYYY-MM-DD': count }
    const countMap = {};
    countAgg.forEach(d => { countMap[d._id] = d.count; });

    // Fill in zeros for missing dates and compute total count
    let totalCount = 0;
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const c = countMap[key] || 0;
      totalCount += c;
    }
    console.log(totalCount)
    const avgTxnsPerDay = totalCount / 30;
    console.log(avgTxnsPerDay)

    // 3) Call your ML forecast service exactly as before
    const mlRes = await axios.post(`${process.env.MLSERVICE_URL}/forecast`, { series });

    // 4) Return the same prediction & daywise + our new average
    return res.json({
      prediction: mlRes.data.forecast * 4,
      daywise: mlRes.data.daywise,
      avgTxnsPerDay
    });
  } catch (err) {
    console.error('Error in getPrediction:', err);
    next(err);
  }
};


// Helper: convert "YYYY-MM" into start/end dates
exports.getMonthlyCategoryTotals = async (req, res, next) => {
  try {
    // 1) Ensure user is authenticated (req.user._id must exist)
    const userId = req.user.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized: user not found' });
    }

    // 2) Build aggregation pipeline:
    //    - $match only this user’s transactions
    //    - $project a “yearMonth” field in format "YYYY-MM" via $dateToString
    //    - $group by both yearMonth and category, summing amounts
    //    - $group again by yearMonth to assemble { category: total, … } objects
    const aggregation = await Transaction.aggregate([
      {
        $match: {
          userId: userId,
        }
      },
      {
        // Convert each transaction’s date into a "YYYY-MM" string
        $project: {
          yearMonth: { $dateToString: { format: '%Y-%m', date: '$date' } },
          category: 1,
          amount: 1
        }
      },
      {
        // First grouping: by yearMonth + category
        $group: {
          _id: {
            yearMonth: '$yearMonth',
            category: '$category'
          },
          totalAmount: { $sum: '$amount' }
        }
      },
      {
        // Reshape so each doc is: { yearMonth: "...", category: "...", total: <number> }
        $project: {
          _id: 0,
          yearMonth: '$_id.yearMonth',
          category: '$_id.category',
          total: '$totalAmount'
        }
      },
      {
        // Second grouping: combine all categories under each yearMonth
        $group: {
          _id: '$yearMonth',
          categories: {
            // Create an array of { k: categoryName, v: total } pairs
            $push: {
              k: '$category',
              v: '$total'
            }
          }
        }
      },
      {
        // Finally, convert that array of { k, v } into an object
        $project: {
          _id: 0,
          yearMonth: '$_id',
          totalsByCategory: { $arrayToObject: '$categories' }
        }
      },
      {
        // Sort ascending by yearMonth (e.g. "2025-01", "2025-02", …)
        $sort: { yearMonth: 1 }
      }
    ]);

    // 3) Build a plain object mapping "YYYY-MM" → { categoryName: total, … }
    const result = {};
    aggregation.forEach((doc) => {
      result[doc.yearMonth] = doc.totalsByCategory;
    });

    // 4) Respond with JSON
    return res.json(result);
  } catch (err) {
    return next(err);
  }
};

// controllers/advisorController.js

const { GoogleGenAI, Type } = require("@google/genai");

// Initialize GoogleGenAI with an API key
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

exports.getAiInsights = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { budget, expense, limits } = req.body;
    // planner: { month, budget, futureExpenses }

    // 1) Fetch user budgets
    const user = await User.findById(userId);
    const budgets = user.budgets;

    // 2) Compute last 3 months' spending
   const threeMonthsAgo = new Date();
threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  // Use `new` when constructing ObjectId
const userObjectId = new mongoose.Types.ObjectId(req.user.id);

const historyAgg = await Transaction.aggregate([
  {
    $match: {
      userId: userObjectId,
      date: { $gte: threeMonthsAgo }
    }
  },
  {
    $group: {
      _id: { month: { $month: '$date' }, year: { $year: '$date' } },
      total: { $sum: '$amount' }
    }
  },
  {
    $sort: { '_id.year': 1, '_id.month': 1 }
  }
]);

const spendingHistory = historyAgg.map(d => ({
  month: `${d._id.month}/${d._id.year}`,
  total: d.total
}));


    // 3) Build the prompt for Gemini (requesting “insights” instead of “tips”)
    const prompt = `
You are an expert budgeting advisor.
User budgets: ${JSON.stringify(budget)}.
Last 3 months spending: ${JSON.stringify(spendingHistory)}.
Budget plan for this month with budget: ₹${budget} with future planned expenses ${JSON.stringify(
      expense
    )}.
and category wise maximum limit of spending is ${JSON.stringify(limits)}
Provide exactly 3–4 actionable, short and brief, personalized, invaluable insights (in JSON format) that are “life-saving” for optimizing their budget plan and forecasting.
    `.trim();

    // 4) Call Gemini via @google/genai, expecting an array of { insight: string }
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
              insight: { type: Type.STRING },
            },
            required: ["insight"],
            propertyOrdering: ["insight"],
          },
        },
      },
    });

    // 5) Extract raw text and parse JSON array of insights
    const candidate = geminiResponse.candidates?.[0];
    let insightObjects = [];

    if (
      candidate?.content?.parts &&
      Array.isArray(candidate.content.parts) &&
      candidate.content.parts.length > 0 &&
      typeof candidate.content.parts[0].text === "string"
    ) {
      const rawText = candidate.content.parts[0].text;
      const match = rawText.match(/\[.*\]/s);

      if (match) {
        try {
          insightObjects = JSON.parse(match[0]);
        } catch (parseErr) {
          console.warn("Failed to parse JSON array. Error:", parseErr);
          // Fallback: wrap entire text as a single insight
          insightObjects = [{ insight: rawText.trim() }];
        }
      } else {
        // No bracketed array—wrap entire response in one object
        insightObjects = [{ insight: rawText.trim() }];
      }
    } else {
      // Fallback if content shape is different
      const fallback = candidate?.content;
      if (typeof fallback === "string") {
        const match = fallback.match(/\[.*\]/s);
        if (match) {
          try {
            insightObjects = JSON.parse(match[0]);
          } catch {
            insightObjects = [{ insight: fallback.trim() }];
          }
        } else {
          insightObjects = [{ insight: fallback.trim() }];
        }
      } else {
        insightObjects = [{ insight: "No valid insights returned by Gemini." }];
      }
    }

    // 6) Extract each “insight” string separately
    const insightStrings = insightObjects.map((obj) => obj.insight);

    return res.json({ insights: insightStrings });
  } catch (err) {
    console.error("Advisor error:", err);
    next(err);
  }
};
