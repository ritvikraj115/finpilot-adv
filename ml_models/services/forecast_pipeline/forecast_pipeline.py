import pandas as pd
import numpy as np
from config import *
from data_utils import load_and_preprocess, scale_features, make_sequences, save_scaler
from model_utils import build_model, train_model, save_model

def run_pipeline():
    # 1. Load and preprocess
    df = load_and_preprocess(FILE_PATH)
    print('done1')
    df, scaler = scale_features(df, FEATURE_COLS)
    print('done2')
    save_scaler(scaler, SCALER_PATH)
    print('done3')
    print(df.head())
    # 2. Create sequences
    X, Y = make_sequences(df, FEATURE_COLS, TARGET_COL, SEQ_LEN, HORIZON)
    min_samples = 10
    if len(X) < min_samples:
        reps = int(np.ceil(min_samples / len(X)))
        X = np.tile(X, (reps, 1, 1))[:min_samples]
        Y = np.tile(Y, (reps, 1))[:min_samples]
        print(f'🔁 Replicated sequences to meet minimum of {min_samples} samples.')
    split = int(0.8 * len(X))
    X_train, X_test = X[:split], X[split:]
    Y_train, Y_test = Y[:split], Y[split:]

    # 3. Build + train
    model = build_model(SEQ_LEN, len(FEATURE_COLS), HORIZON)
    model = train_model(model, X_train, Y_train)

    # 4. Save model
    save_model(model, MODEL_PATH)

    print("✅ Pipeline complete and saved.")

if __name__ == '__main__':
    run_pipeline()
