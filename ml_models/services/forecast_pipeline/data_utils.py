import pandas as pd
import numpy as np
from sklearn.preprocessing import MinMaxScaler
import joblib

def load_and_preprocess(path):
    df = pd.read_excel(path, parse_dates=['Date / Time'])
    df.set_index('Date / Time', inplace=True)
    daily = df['Debit/Credit'].resample('D').sum().to_frame()
    daily['roll7'] = daily['Debit/Credit'].rolling(7, min_periods=1).mean()
    daily['log_amt'] = np.log1p(daily['roll7'])
    daily['dow'] = daily.index.dayofweek
    daily['is_weekend'] = (daily['dow'] >= 5).astype(int)
    return daily

def scale_features(daily, features, scaler=None):
    if scaler is None:
        scaler = MinMaxScaler()
        daily[features] = scaler.fit_transform(daily[features])
    else:
        daily[features] = scaler.transform(daily[features])
    return daily, scaler

def make_sequences(df, features, target, seq_len, horizon):
    X, Y = [], []
    data = df[features].values
    target_vals = df[target].values
    for i in range(len(df) - seq_len - horizon + 1):
        print(i)
        X.append(data[i:i+seq_len])
        Y.append(target_vals[i+seq_len:i+seq_len+horizon])
    return np.array(X), np.array(Y)

def save_scaler(scaler, path):
    joblib.dump(scaler, path)

def load_scaler(path):
    return joblib.load(path)
