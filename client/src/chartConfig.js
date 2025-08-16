// src/chartConfig.js

import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { MatrixController, MatrixElement } from 'chartjs-chart-matrix';

ChartJS.register(
  ArcElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  MatrixController,
  MatrixElement
);

// Global defaults
ChartJS.defaults.font.family = "'Roboto', sans-serif";
ChartJS.defaults.font.size = 12;
ChartJS.defaults.color = "#333";

export const commonOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: "top",
      labels: {
        boxWidth: 12,
        padding: 16,
      },
    },
    title: {
      display: false,
    },
    tooltip: {
      padding: 8,
      cornerRadius: 4,
      titleFont: { size: 14, weight: "500" },
      bodyFont: { size: 12 },
    },
  },
  scales: {
    x: {
      grid: {
        display: false,
      },
      ticks: {
        color: "#666",
      },
    },
    y: {
      grid: {
        color: "#eee",
        borderDash: [4, 4],
      },
      ticks: {
        color: "#666",
      },
    },
  },
};
