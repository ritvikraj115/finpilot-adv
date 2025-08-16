# ml_models/forecast_pipeline.py  (replace run_pipeline)
import os
import json
import mlflow
import mlflow.keras
import numpy as np
from datetime import datetime
from config import *
from data_utils import load_and_preprocess, scale_features, make_sequences, save_scaler
from model_utils import build_model, train_model, save_model

def run_pipeline():
    # 1. Load and preprocess
    df = load_and_preprocess(FILE_PATH)
    df, scaler = scale_features(df, FEATURE_COLS)
    save_scaler(scaler, SCALER_PATH)

    # 2. Create sequences
    X, Y = make_sequences(df, FEATURE_COLS, TARGET_COL, SEQ_LEN, HORIZON)
    min_samples = 10
    if len(X) < min_samples:
        reps = int(np.ceil(min_samples / len(X)))
        X = np.tile(X, (reps, 1, 1))[:min_samples]
        Y = np.tile(Y, (reps, 1))[:min_samples]

    split = int(0.8 * len(X))
    X_train, X_test = X[:split], X[split:]
    Y_train, Y_test = Y[:split], Y[split:]

    # 3. Build
    model = build_model(SEQ_LEN, len(FEATURE_COLS), HORIZON)

    # ---- MLflow instrumentation start ----
    mlflow_tracking_uri = os.environ.get('MLFLOW_TRACKING_URI', MLFLOW_TRACKING_URI)
    if mlflow_tracking_uri:
        mlflow.set_tracking_uri(mlflow_tracking_uri)
    mlflow.set_experiment(os.environ.get('MLFLOW_EXPERIMENT', MLFLOW_EXPERIMENT))

    with mlflow.start_run() as run:
        run_id = run.info.run_id
        # log params
        mlflow.log_param('seq_len', SEQ_LEN)
        mlflow.log_param('horizon', HORIZON)
        mlflow.log_param('n_samples', len(X))
        # train
        model = train_model(model, X_train, Y_train)
        # evaluate on X_test / Y_test
        # compute RMSE or MAE
        try:
            preds = model.predict(X_test)
            # preds shape: (n, horizon, 1) ; Y_test shape: (n, horizon)
            preds_flat = preds.reshape(preds.shape[0], preds.shape[1])
            y_flat = Y_test
            rmse = np.sqrt(np.mean((preds_flat - y_flat) ** 2))
            mlflow.log_metric('val_rmse', float(rmse))
        except Exception as e:
            print('warning: evaluation failed', e)

        # Save model artifact via mlflow
        # For Keras models:
        mlflow.keras.log_model(model, artifact_path='model')

        # Also save local keras model & scaler for the running service
        os.makedirs(ARTIFACT_DIR, exist_ok=True)
        local_model_path = os.path.join(ARTIFACT_DIR, f'saved_lstm_model_{run_id}.h5')
        model.save(local_model_path)
        save_scaler(scaler, os.path.join(ARTIFACT_DIR, f'scaler_{run_id}.pkl'))

        # Optionally log those files as artifacts too
        mlflow.log_artifact(local_model_path, artifact_path='pkl')
        mlflow.log_artifact(os.path.join(ARTIFACT_DIR, f'scaler_{run_id}.pkl'), artifact_path='pkl')

        # Write metadata file for server to pick up
        metadata = {
            'run_id': run_id,
            'local_model_path': local_model_path,
            'scaler_path': os.path.join(ARTIFACT_DIR, f'scaler_{run_id}.pkl'),
            'mlflow_run': run.info.run_id,
            'timestamp': datetime.utcnow().isoformat()
        }
        with open(MODEL_METADATA_PATH, 'w') as f:
            json.dump(metadata, f)

        print(f"✅ Pipeline complete and saved. run_id={run_id}")
        return metadata

if __name__ == '__main__':
    run_pipeline()

