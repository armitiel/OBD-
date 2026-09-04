package pl.obdai.scanner;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BluetoothSerialPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
