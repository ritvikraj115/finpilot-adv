from tensorflow.keras.models import Sequential, load_model
from tensorflow.keras.layers import LSTM, RepeatVector, TimeDistributed, Dense, Dropout
from tensorflow.keras.callbacks import EarlyStopping

def build_model(seq_len, n_features, horizon):
    model = Sequential([
        LSTM(64, input_shape=(seq_len, n_features), dropout=0.2),
        RepeatVector(horizon),
        LSTM(32, return_sequences=True, dropout=0.2),
        TimeDistributed(Dense(1))
    ])
    model.compile(optimizer='adam', loss='huber')
    return model

def train_model(model, X_train, y_train, val_split=0.1, epochs=50, batch_size=16):
    es = EarlyStopping(monitor='val_loss', patience=5, restore_best_weights=True)
    model.fit(
        X_train, y_train,
        validation_split=val_split,
        epochs=epochs,
        batch_size=batch_size,
        callbacks=[es],
        verbose=1
    )
    return model

def save_model(model, path):
    model.save(path)

def load_trained_model(path):
    return load_model(path)
