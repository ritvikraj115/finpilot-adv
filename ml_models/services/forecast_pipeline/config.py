# ml_models/config.py  (edit)
SEQ_LEN = 30
HORIZON = 7
FEATURE_COLS = ['log_amt', 'dow', 'is_weekend']
TARGET_COL = 'log_amt'
FILE_PATH = 'personal_finance_data_augmented_filled_amounts.xlsx'
MODEL_PATH = 'saved_lstm_model.h5'        # note: remove duplicated .h5.h5 if present
SCALER_PATH = 'scaler.pkl'
FORECAST_OUTPUT = 'lstm_seq2seq_forecast.xlsx'

# Day4 additions:
MLFLOW_EXPERIMENT = 'finpilot-forecast'
MLFLOW_TRACKING_URI = None   # if None, mlflow uses ./mlruns by default
MODEL_METADATA_PATH = 'model_metadata.json'   # small local metadata file updated after each run
ARTIFACT_DIR = 'artifacts'   # where pipeline writes extra artifacts (optional)

