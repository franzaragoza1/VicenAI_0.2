using GameReaderCommon;
using SimHub.Plugins;
using Newtonsoft.Json;
using System;
using System.Net.Sockets;
using System.Text;
using System.Reflection;
using System.Collections.Generic;

namespace SimHubTelemetryExporter
{
    [PluginName("AI Telemetry Explorer")]
    [PluginDescription("Discovers and exports ALL available telemetry fields")]
    public class TelemetryExplorerPlugin : IPlugin, IDataPlugin
    {
        public PluginManager PluginManager { get; set; }

        private UdpClient udp;
        private long lastSend;
        private const int TARGET_HZ = 10; // Reducido para no saturar con tantos datos
        private const string TARGET_IP = "127.0.0.1";
        private const int TARGET_PORT = 9999;
        private HashSet<string> discoveredFields = new HashSet<string>();

        public void Init(PluginManager pluginManager)
        {
            PluginManager = pluginManager;
            udp = new UdpClient();
            lastSend = 0;
        }

        public void DataUpdate(PluginManager pluginManager, ref GameData data)
        {
            if (!data.GameRunning || data.NewData == null)
                return;

            long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (now - lastSend < 1000 / TARGET_HZ)
                return;

            lastSend = now;

            try
            {
                // Usar reflexión para obtener TODAS las propiedades disponibles
                var packet = new Dictionary<string, object>();
                
                // Timestamp siempre
                packet["Timestamp"] = now;
                packet["GameName"] = data.GameName ?? "Unknown";
                packet["GameRunning"] = data.GameRunning;
                
                // 1. EXPLORAR data.NewData (donde está la mayoría de los datos)
                if (data.NewData != null)
                {
                    ExploreObject(data.NewData, "", packet);
                }
                
                // 2. EXPLORAR data.OldData (para comparaciones)
                if (data.OldData != null)
                {
                    ExploreObject(data.OldData, "Old_", packet);
                }
                
                // 3. EXPLORAR data.GameData (si existe)
                if (data.GameData != null)
                {
                    ExploreObject(data.GameData, "GameData_", packet);
                }
                
                // 4. Propiedades adicionales del objeto data mismo
                Type dataType = data.GetType();
                PropertyInfo[] dataProperties = dataType.GetProperties();
                foreach (PropertyInfo prop in dataProperties)
                {
                    try
                    {
                        // Evitar recursión infinita
                        if (prop.Name == "NewData" || prop.Name == "OldData" || prop.Name == "GameData")
                            continue;
                            
                        if (prop.CanRead)
                        {
                            object value = prop.GetValue(data);
                            string fieldName = "Data_" + prop.Name;
                            AddValueToPacket(packet, fieldName, value);
                        }
                    }
                    catch { }
                }
                
                // Agregar estadísticas de campos descubiertos
                packet["_TotalDiscoveredFields"] = discoveredFields.Count;
                packet["_DiscoveredFieldsList"] = string.Join(",", discoveredFields);

                string json = JsonConvert.SerializeObject(packet, Formatting.None);
                byte[] bytes = Encoding.UTF8.GetBytes(json);
                udp.Send(bytes, bytes.Length, TARGET_IP, TARGET_PORT);
                
                // Log periódico de progreso
                if (discoveredFields.Count % 10 == 0)
                {
                    Console.WriteLine($"📊 Total campos descubiertos hasta ahora: {discoveredFields.Count}");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ Error en DataUpdate: {ex.Message}");
            }
        }

        public void End(PluginManager pluginManager)
        {
            Console.WriteLine($"🎯 RESUMEN FINAL: Se descubrieron {discoveredFields.Count} campos de telemetría");
            Console.WriteLine("📋 Campos encontrados:");
            foreach (var field in discoveredFields)
            {
                Console.WriteLine($"   • {field}");
            }
            
            udp?.Dispose();
        }
        
        // Método helper para explorar objetos recursivamente
        private void ExploreObject(object obj, string prefix, Dictionary<string, object> packet)
        {
            if (obj == null)
                return;
                
            Type objType = obj.GetType();
            PropertyInfo[] properties = objType.GetProperties();
            
            foreach (PropertyInfo prop in properties)
            {
                try
                {
                    if (prop.CanRead)
                    {
                        object value = prop.GetValue(obj);
                        string fieldName = prefix + prop.Name;
                        AddValueToPacket(packet, fieldName, value);
                    }
                }
                catch (Exception ex)
                {
                    // Log error but continue
                    packet[prefix + prop.Name + "_Error"] = ex.Message;
                }
            }
        }
        
        // Método helper para agregar valores al packet
        private void AddValueToPacket(Dictionary<string, object> packet, string fieldName, object value)
        {
            // Agregar a campos descubiertos
            if (!discoveredFields.Contains(fieldName))
            {
                discoveredFields.Add(fieldName);
                Console.WriteLine($"🔍 Nuevo campo descubierto: {fieldName} = {value}");
            }
            
            // Convertir valores complejos
            if (value == null)
            {
                packet[fieldName] = null;
            }
            else if (value is DateTime dt)
            {
                packet[fieldName] = dt.ToString("HH:mm:ss.fff");
            }
            else if (value is TimeSpan ts)
            {
                packet[fieldName] = ts.ToString(@"mm\:ss\.fff");
            }
            else if (value.GetType().IsPrimitive || value is string || value is decimal)
            {
                packet[fieldName] = value;
            }
            else if (value is Array arr)
            {
                // Arrays: convertir a string resumido
                packet[fieldName] = $"[Array:{arr.Length}]";
            }
            else if (value.GetType().IsClass && value.GetType() != typeof(string))
            {
                // Objetos complejos: convertir a string
                packet[fieldName] = value.ToString();
            }
            else
            {
                packet[fieldName] = value.ToString();
            }
        }
    }
}