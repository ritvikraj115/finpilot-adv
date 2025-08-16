# config.py
SEQ_LEN = 30
HORIZON = 7
FEATURE_COLS = ['log_amt', 'dow', 'is_weekend']
TARGET_COL = 'log_amt'
FILE_PATH = 'personal_finance_data_augmented_filled_amounts.xlsx'
MODEL_PATH = 'saved_lstm_model.h5.h5'
SCALER_PATH = 'scaler.pkl'
FORECAST_OUTPUT = 'lstm_seq2seq_forecast.xlsx'
