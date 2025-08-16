import numpy as np
import pandas as pd
from datetime import timedelta
from config import *
from data_utils import load_and_preprocess, scale_features, load_scaler
from model_utils import load_trained_model

def forecast_next():
    df = load_and_preprocess(FILE_PATH)
    scaler = load_scaler(SCALER_PATH)
    df, _ = scale_features(df, FEATURE_COLS, scaler)

    model = load_trained_model(MODEL_PATH)
    seq_input = df[FEATURE_COLS].values[-SEQ_LEN:]
    pred_scaled = model.predict(seq_input.reshape(1, SEQ_LEN, len(FEATURE_COLS)))[0, :, 0]

    # Invert scale and log
    dummy = np.zeros((HORIZON, len(FEATURE_COLS)))
    dummy[:, 0] = pred_scaled
    inv = scaler.inverse_transform(dummy)[:, 0]
    forecast = np.expm1(inv)

    start = df.index[-1] + timedelta(days=1)
    dates = pd.date_range(start, periods=HORIZON)
    forecast_df = pd.DataFrame({'Date': dates, 'Forecast_Amount': forecast})
    forecast_df.to_excel(FORECAST_OUTPUT, index=False)
    print(f"✅ Forecast saved to {FORECAST_OUTPUT}")

if __name__ == '__main__':
    forecast_next()
