/**
 * MQTT for esp-01
 * 
 * @copyright	MIT Lesser General Public License
 *
 * @author [email](vshang2006@163.com)
 * @version  V1.X
 * @date  2021-03-22
 */

enum TOPIC_CLASS {
    //% block="TOPIC1"
    Topic1=0,
    //% block="TOPIC2"
    Topic2=1, 
    //% block="TOPIC3"
    Topic3=2,
    //% block="TOPIC4"
    Topic4=3,
    //% block="TOPIC5"
    Topic5=4, 
}

let MQTTEvent = 200
let MQTTEventID = 2
let MQTTEventCMD = 6


//% weight=10 icon="\uf1eb" block="MQTT" color="#1533aa"
namespace mqtt_4_esp01 {
    const TIMEOUT = 1000;         //两次读取缓冲间的超时时间
    const REMAINING_LEN_MAX = 127 //剩余长度最大容量

    //固定头中的首个命令字
    const CONNACK   = 0x20;
    const SUBACK    = 0x90;
    const PUBACK    = 0x40;
    const UNSUBACK  = 0xB0;
    const PINGRESP  = 0xD0;
    const PUBLIC1   = 0x30;
    const PUBLIC2   = 0x31;
    
    //待发送的固定数据头
    const CONNECT_BUFF = [0x10,0x00,0x00,0x04,0x4D,0x51,0x54,0x54,0x04,0xc2,0x00,0x0f];
    const SUBSCRIBE_BUFF = [0x82,0x00,0x00,0x02];
    const UNSUBSCRIBE_BUFF = [0xa2,0x00,0x00,0x02];
    const PUBLIC_BUFF = [0x30,0x00];
    const PING_BUFF =[0xc0,0x00]
    const DISCONNECT_BUFF =[0xe0,0x00]
    
    //标志
    class Flag{
        public flag:boolean
        public payload:number
        constructor(v:boolean){
            this.flag=v
            this.payload=-1
        }
    }

    class Information {
        public _buff:Array<number>=[]
        public constructor(){}
        public str2info(t:string,v:string){
            this._buff=PUBLIC_BUFF.concat(str2array(t))
            this._buff=this._buff.concat(str2array(v,false))
            this._buff[1]=this._buff.length-2       //设置剩余长度  限定：登录信息总长度不超过128个字符
        }
        public arr2info(t:string,v:Array<number>){
            this._buff=PUBLIC_BUFF.concat(str2array(t))
            this._buff=this._buff.concat(v)
            this._buff[1]=this._buff.length-2       //设置剩余长度  限定：登录信息总长度不超过128个字符
        }      
        public oneNetNum2info(dp:string,data:number){
            this._buff=PUBLIC_BUFF.concat(str2array("$dp"))
            this._buff=this._buff.concat([0x03])         //Type3
            this._buff=this._buff.concat(str2array("{\""+dp+"\":"+data+"}",true))//payload
            this._buff[1]=this._buff.length-2       //设置剩余长度  限定：登录信息总长度不超过128个字符
        }
        public oneNetStr2info(dp:string,data:string){
            this._buff=PUBLIC_BUFF.concat(str2array("$dp"))
            this._buff=this._buff.concat([0x03])         //Type3
            this._buff=this._buff.concat(str2array("{\""+dp+"\":\""+data+"\"}",true))//payload
            this._buff[1]=this._buff.length-2       //设置剩余长度  限定：登录信息总长度不超过128个字符
        }
        public oneNetCMD2info(uuid:string,cmd:string){
            this._buff=PUBLIC_BUFF.concat(str2array("$crsp/"+uuid))
            this._buff=this._buff.concat(str2array(cmd,false))//payload
            this._buff[1]=this._buff.length-2       //设置剩余长度  限定：登录信息总长度不超过128个字符
        }
    }
    //ESP是否被初始化
    let esp01_init=false
    //MQTT服务器配置信息
    let mqtt_server = ""
    let mqtt_port = 0
    let mqtt_client = "" 
    let mqtt_username = ""
    let mqtt_password = ""
    //定义有关标志变量
    let mqtt_connect=new Flag(false)  //是否收到登录
    let mqtt_sub=new Flag(false)    //是否收到注册主题
    let mqtt_unsub=new Flag(false)    //是否收到取消注册主题
    let mqtt_ping=new Flag(false)   //是否收到Ping成功
    let mqtt_public=new Flag(false)   //是否收到发布成功
    //主题的文本字符串
    let Topic_Data=["*","*","*","*","*","*"]
    //信息队列
    let payload_array:Array<Array<string>>=[]
    //命令队列
    let cmd_array:Array<Array<string>>=[]
    //信息到达时的回调函数
    let SerialDataCallback:Array<(v:string)=>void>=[
        function(_d:string){},
        function(_d:string){},
        function(_d:string){},
        function(_d:string){},
        function(_d:string){}
        ] 
    //命令到达时的回调函数
    let SerialCMDCallback:(u:string,p:string)=>void=function(u:string,p:string){}

    
    /**
     * 当收到数据信息后的事件设定
     */
    //% weight=80
    //% blockId=onEventSerialData block="Receive $data from $topic"
    //% blockExternalInputs=1
    //% draggableParameters="topic"
    //% blockGap=8
    //% group="Event"
    export function onEventSerialData(topic:TOPIC_CLASS, handler: (data: string) => void) {
        SerialDataCallback[topic]=handler
    }

    /**
     * 当收到OneNET命令后的事件设定
     */
    //% weight=80
    //% blockId=onEventSerialCMD block="Receive OneNet CMD $data from $cmd_uuid"
    //% blockExternalInputs=1 advanced=true
    //% draggableParameters="data"
    //% blockGap=8
    //% group="OneNet"
    export function onEventSerialCMD(handler: (cmd_uuid: string, data: string) => void) {
        SerialCMDCallback=handler
    }
    
    /**
     * 
     * 发送 0x00
     */
    function send0x00():void{
        serial.writeBuffer(Buffer.fromArray([0x00]))
    }
    /**
     * 设置串口信息
     * 参数：重定向到串口 发送：TX；接受：RX；波特率：rate
     * 返回：无
    */
    //% weight=100
    //% blockId=set_Esp01_io block="Set serial|TX %tx|RX %rx|at baud rate %rate"
    //% blockExternalInputs=1
    //% tx.fieldEditor="gridpicker" tx.fieldOptions.columns=3
    //% tx.fieldOptions.tooltips="false"
    //% rx.fieldEditor="gridpicker" rx.fieldOptions.columns=3
    //% rx.fieldOptions.tooltips="false"
    //% blockGap=8
    //% group="Init"
    export function set_io(tx:SerialPin, rx:SerialPin, rate:BaudRate) :void {
        serial.redirect(tx, rx, rate)
        serial.setTxBufferSize(128)
        serial.setRxBufferSize(128)
        send0x00()
    }
    /**
     * 等待串口返回的字符，只可以在初始化串口的时候使用
     */
    function wait4str(str:string,timeout:number):boolean{
        let _this_monent=control.millis()
        let d=serial.readString()
        let result=false
        while(control.millis()-_this_monent < timeout){
            if(d.indexOf(str)>=0){
                result=true;
                break;
            }
            d=serial.readString()
            basic.pause(10)
        }
        return result
    }

    /**
     * 设置ESP01模块
     * 参数：
     * 返回：无
    */
    //% weight=99
    //% blockId=init_esp01 block="Init ESP01|SSID %tx|password %rx|MQTT Server %server|MQTT Server port %port"
    //% blockGap=8
    //% group="Init"
    export function init_esp01(SSID:string,password:string,server:string,port:number):void{
        basic.pause(500);
        serial.writeString("+++");
        basic.pause(1000);
        serial.writeString("AT"+serial.NEW_LINE);
        if(!wait4str("OK",500)){
            basic.showString("ESP01 ERROR")
            control.reset()
        }   //不死等
        serial.writeString("AT+RESTORE" + serial.NEW_LINE);
        while(!wait4str("ready",1000)){}  //死等
        serial.writeString("ATE0" + serial.NEW_LINE);
        while(!wait4str("OK",500)){}  //死等
        serial.writeString("AT+CWMODE_DEF=1" + serial.NEW_LINE);
        while(!wait4str("OK",500)){}  //死等
        serial.writeString("AT+CWJAP_DEF=\""+SSID+"\",\""+password+"\"" + serial.NEW_LINE);
        if(!wait4str("OK",10000)){
            basic.showString("WIFI FAIL")
            control.reset()
        }  //不死等
        serial.writeString("AT+CIPMODE=1" + serial.NEW_LINE);
        while(!wait4str("OK",500)){}  //死等
        serial.writeString("AT+SAVETRANSLINK=1,\""+server+"\","+port + serial.NEW_LINE);
        while(!wait4str("OK",500)){}  //死等
        serial.writeString("AT+RST" + serial.NEW_LINE);
        while(!wait4str("ready",10)){}  //死等
        basic.pause(5000) //硬等待5秒，待建立连接，如果不足，外面再等待若干秒
        //连接完成
        esp01_init=true;
    }

    /**
     * 
     * 返回 初始化ESP01是否完成
     * 参数：无
     * 返回：已完成 true；未完成 false
     */
    //% weight=95
    //% blockId=is_esp01_init block="Is ESP01 init"
    //% blockExternalInputs=1
    //% blockGap=8
    //% group="Init"
    export function is_esp01_init ():boolean{
        return esp01_init
    }

    /**
     * 
     * 返回 登录反馈信息
     * 参数：五
     * 返回：反馈信息代码
     * -1 0xff 连接超时
     * 0 0x00 连接已接受 连接已被服务端接受
     * 1 0x01 连接已拒绝，不支持的协议版本 服务端不支持客户端请求的 MQTT 协议级别
     * 2 0x02 连接已拒绝，不合格的客户端标识符 客户端标识符是正确的 UTF-8 编码，但服务端不允许使用
     * 3 0x03 连接已拒绝，服务端不可用 网络连接已建立，但 MQTT 服务不可用
     * 4 0x04 连接已拒绝，无效的用户名或密码 用户名或密码的数据格式无效 MQTT-3.1.1-CN 30
     * 5 0x05 连接已拒绝，未授权 客户端未被授权连接到此服务器
     */
    //% weight=95
    //% blockId=connectack_code block="ConnectAck code" 
    //% blockExternalInputs=1
    //% blockGap=8
    //% group="Init"
    export function connectack_code ():number{
        return mqtt_connect.payload
    }

    /**
     * 
     * 发送缓冲区数据，并等待返回，
     * 参数：_timeout 超时时间；_flag 期间需要检查的反馈标志；_buff 待发送的数据（数字数组）
     * 返回：成功返回true，失败返回 false
     */
    function send_and_check_resp(_timeout:number,_flag:Flag,_buff:Array<number>):boolean{
        _flag.flag=false//初始化标志
        serial.writeBuffer(Buffer.fromArray(_buff))
        let this_time=control.millis();
        while(control.millis()-this_time <_timeout){  ///time out
            if(_flag.flag){ //未超时的时间段内收到标志
                return true //发送成功
            }
            basic.pause(10)
        }
        return false //超时未收到
    }
    /**
     * 
     * 配置订阅信息
     * 
     */
    //% weight=85
    //% blockId=set_MQTT_SubTopic block="Set |%topic as |%topic_id"
    //% blockExternalInputs=1
    //% _topic_name.defl=""
    //% _topic_id.defl=TOPIC_CLASS.Topic1
    //% group="Init"
    export function set_MQTT_SubTopic(_topic_id:TOPIC_CLASS,_topic_name:string) :void{
        Topic_Data[_topic_id]=_topic_name
    }
    
    /**
     * 
     * 从缓冲区读取一个字节，直到读取到位置，如果读取时间超过TIMEOUT设定，则抛出"timeout"异常
     * 简而言之，调用本函数，必须缓冲区内有数据
     * 参数：无
     * 返回：返回读取到的数据
     */
    function read_serial_a_byte(): number {
        let _this_moment=control.millis();
        let _buf=serial.readBuffer(1);
        let _now=control.millis()
        if (_now - _this_moment > TIMEOUT){  ///time out
            throw "timeout"
        }
        return _buf[0]
    }


    /**
     * 
     * 从缓冲区读取count字节到缓冲，如果单词读取时间超过TIMEOUT设定，则会从内部抛出"timeout"异常
     * 简而言之，调用本函数，必须缓冲区内有数据
     * 参数：读取的数据长度
     * 返回：读取到的缓冲区
     */
    function read_serial_bytes(_count :number): Buffer {
        let _b=pins.createBuffer(_count)
        for(let _i=0; _i<_count; _i++){
                _b[_i]=read_serial_a_byte()
        }
        return _b
    }
    /**
     * 
     * 将字符串转换为MQTT字符串格式，字符串不能超过256*256长度
     * 参数：-V 字符串 ; -h 是否带MSB LSB
     * 返回：转化好的字符串（以数组形式）
     */
    function str2array(_v:string,_h:boolean=true):Array<number>{
        let _r:Array<number>=[]
        if(_h){_r=_r.concat([_v.length / 256 ,_v.length % 256]) } //如果带字符串长度，2个字节}
        for(let _i=0;_i<_v.length;_i++){
            _r=_r.concat([_v.charCodeAt(_i)])
        }
        return _r
    }

    /**
     * 
     * 设置 登录信息
     * 参数：_client 客户端名称 ；_username 用户名；_password 密码 ；_timeout 超时时间；以 mqtt_connect 为依据
     * 返回：无
     */
    //% weight=95
    //% blockId=init_MQTT_info block="Init MQTT|client %client|username %username|password %password"
    //% blockExternalInputs=1
    //% client.defl=""
    //% username.defl=""
    //% password.defl=""
    //% blockGap=8
    //% group="Init"
    export function init_MQTT_info(_client:string,_username:string,_password:string):void{
        mqtt_client =_client
        mqtt_username = _username
        mqtt_password = _password
    }

    /**
     * 
     * 发送 登录信息
     * 参数：_timeout 超时时间；以 mqtt_connect 为依据
     * 返回：成功返回true，失败返回 false 
     */
    //% weight=90
    //% blockId=send_MQTT_connect block="Connect|timeout %_timeout (s)"
    //% _timeout.defl="2"
    //% blockGap=8
    //% group="Community"
    export function send_MQTT_connect(_timeout:number):boolean{
        _timeout=Math.round(_timeout*1000)
        let _buff=CONNECT_BUFF.concat(str2array(mqtt_client))
        _buff=_buff.concat(str2array(mqtt_username))
        _buff=_buff.concat(str2array(mqtt_password))
        _buff[1]=_buff.length-2 //设置剩余长度  限定：登录信息总长度不超过128个字符
        if(send_and_check_resp(_timeout,mqtt_connect,_buff)){ 
            //如果收到返回信息，再需要判断是否登录成功
            if(mqtt_connect.payload==0x00){
                return true
            }else{
                basic.showString("CONN FAIL")
                return false
            }
        }else{
            //超时，登录失败
            basic.showString("CONN TIMEOUT")
            return false
        }
    }

    /**
     * 
     * 发送 订阅信息
     * 参数：_topic_id 订阅编号 ; _timeout 超时时间；以 mqtt_sub 为依据
     * 返回：成功返回true，失败返回 false 
     */
    //% weight=83
    //% blockId=send_MQTT_subTopic block="SubTopic|%topic_id|timeout%_timeout (s)"
    //% _timeout.defl="2"
    //% _topic_id.defl=TOPIC_CLASS.Topic1
    //% blockGap=8
    //% group="Community"
    export function send_MQTT_subTopic(_topic_id:TOPIC_CLASS,_timeout:number):boolean{
        _timeout=Math.round(_timeout*1000)
        let _buff=SUBSCRIBE_BUFF.concat(str2array(Topic_Data[_topic_id]))
        _buff=_buff.concat([0x00])
        _buff[1]=_buff.length-2
        return send_and_check_resp(_timeout,mqtt_sub,_buff)
    }

    /**
     * 
     * 发送 取消订阅信息
     * 参数：_topic_id 订阅编号 ; _timeout 超时时间；以 mqtt_sub 为依据
     * 返回：成功返回true，失败返回 false 
     */
    //% weight=80
    //% blockId=send_MQTT_unsubTopic block="UnSubTopic|%topic_id|timeout%_timeout (s)"
    //% _timeout.defl="2"
    //% topic_id.defl=TOPIC_CLASS.Topic1
    //% blockGap=8
    //% group="Community"
    export function send_MQTT_unsubTopic(_topic_id:TOPIC_CLASS,_timeout:number):boolean{
        _timeout=Math.round(_timeout*1000)
        let _buff=UNSUBSCRIBE_BUFF.concat(str2array(Topic_Data[_topic_id]))
        _buff[1]=_buff.length-2
        return send_and_check_resp(_timeout,mqtt_unsub,_buff)
    }



    /*
     * 依据字符串生成待发送数据
     * 参数：_topic_name 主题名称; _payload 字符串数据
     * 返回：生成的Info
     */
    //% weight=80
    //% blockId=get_Info_by_str block="Send |String%_payload |to%_topic_name"
    //% blockGap=8
    //% group="Information"
    export function get_Info_by_str(_topic_name:string,_payload:string) : Information{
        let result = new Information()
        result.str2info(_topic_name,_payload)
        return result
    }
    /*
     * 依据数组生成待发送数据
     * 参数：_topic_name 主题名称; _payload 数组数据
     * 返回：生成的Info
     */
    //% weight=80
    //% blockId=get_Info_by_array block="Send |Array %_payload |to%_topic_name"
    //% blockGap=8
    //% group="Information"
    export function get_Info_by_array(_topic_name:string,_payload:Array<number>) : Information{
        let result = new Information()
        result.arr2info(_topic_name,_payload)
        return result
    }
    /*
     * 依据字符串生成OneNet Type3类型的数据  {"数据点":"字符串"}
     * 参数：_data_point 数据节点;_data 字符串数据 
     * 返回：数据
     */
    //% weight=80
    //% blockId=get_Info_by_OneNetType3_str block="OneNET |DPName%_data_point|string%_data"
    //% blockGap=8
    //% group="OneNet"
    export function get_Info_by_OneNetType3_str(_data_point:string,_data:string) : Information{
        let result = new Information()
        result.oneNetStr2info(_data_point,_data)
        return result
    }
    /*
     * 依据数字生成OneNet Type3类型的数据  {"数据点":数字}
     * 参数：_data_point 数据节点;_data 数值数据 
     * 返回：数据
     */
    //% weight=80
    //% blockId=get_Info_by_OneNetType3_num block="OneNET |DPName%_data_point|number%_data"
    //% blockGap=8
    //% group="OneNet"
    export function get_Info_by_OneNetType3_num(_data_point:string,_data:number) : Information{
        let result = new Information()
        result.oneNetNum2info(_data_point,_data)
        return result
    }

    /*
     * 依据字符串生成待发送命令格式数据
     * 参数：uuid  命令uuid ;_cmd 回复命令
     * 返回：数据
     */
    //% weight=80
    //% blockId=get_Info_by_OneNet_CMD block="OneNET |UUID%_uuid|Cmd%_cmd"
    //% blockGap=8
    //% group="OneNet"
    export function get_Info_by_OneNet_CMD(_uuid:string,_cmd:string) : Information{
        let result = new Information()
        result.oneNetCMD2info(_uuid,_cmd)
        return result
    }
    /*
     * 发送 发布信息
     * 参数：info 信息；_timeout 超时时间；以 mqtt_public 为依据
     * 返回：成功返回true，失败返回 false ; 
     */
    //% weight=75
    //% blockId=send_MQTT_public block="Public|info:%_info"
    //% _timeout.defl="2000"
    //% blockGap=8
    //% group="Community"
    export function send_MQTT_public(_info:Information) : void{
        send_and_check_resp(-1,mqtt_public,_info._buff) //不等待超时，Qos0 不返回结果
    }
    
    /**
     * 
     * 发送 Ping信息
     * 参数： _timeout 超时时间 ；以 mqtt_ping 为依据
     * 返回：成功返回true，失败返回 false
     */
    //% weight=70
    //% blockId=send_MQTT_ping block="Ping $_timeout (s)"
    //% _timeout.defl="2"
    //% group="Community"
    export function send_MQTT_ping(_timeout :number) : boolean{
        _timeout=Math.round(_timeout*1000)
        return send_and_check_resp(_timeout,mqtt_ping,PING_BUFF)
    }
    
     /**
     * 
     * 发送 连接断开信息
     * 参数：无
     * 返回：无
     */
    //% weight=50
    //% blockId=send_MQTT_disconnect block="Disconnect"
    //% group="Community"
    export function send_MQTT_disconnect(): void{
        serial.writeBuffer(Buffer.fromArray(DISCONNECT_BUFF))
    }

    /**
     * 
     * 调用 主题文本名称 对应的事件
     * 参数： _topic_name 主题文本名称 ;payload 负载数据
     * 返回：无
     */
    function run_topic_callback(_topic_name:string,payload:string) :void{
        //数据报文
        switch(_topic_name){
            case Topic_Data[TOPIC_CLASS.Topic1]:
            case Topic_Data[TOPIC_CLASS.Topic2]:
            case Topic_Data[TOPIC_CLASS.Topic3]:
            case Topic_Data[TOPIC_CLASS.Topic4]:
            case Topic_Data[TOPIC_CLASS.Topic5]:
                payload_array.push([_topic_name,payload])
                control.raiseEvent(MQTTEvent, MQTTEventID)
                break;
        }
        //OneNET CMD报文
        if(_topic_name.indexOf("$creq")==0){
            cmd_array.push([_topic_name.substr(6,36),payload])
            control.raiseEvent(MQTTEvent, MQTTEventCMD)
        }
    }

     /**
     * 
     * 读取MQTT报文中"剩余长度"大小，如果数值大小超过128，则抛出"too_big"异常
     * 
     * 参数：无
     * 返回：读取到的"剩余长度"大小
     */
    function get_remaining_length() : number{
        basic.pause(10)   //V2 在此处必须等待，原因未知
        let len=read_serial_a_byte() ;
        if(len >= REMAINING_LEN_MAX){                       
            throw "too_big";
        }
        //serial.writeLine("remaining_length:"+len)
        return len
    }

    /*
     * 
     * 清除串口缓冲区
     */
    function clean_buff() : void{//清空缓冲区
        while(serial.readString().length>0){} //清空缓冲区
        //serial.readBuffer(0).length>0
    }

    /*
     * 事件监听 发现总线上存在MQTT命令事件，则执行相应的代码
     */
    control.onEvent(MQTTEvent, MQTTEventCMD, function () {       
        if(cmd_array.length>0){
            let item=cmd_array.shift()
            let cmd_uuid=item[0]
            let payload=item[1]
            SerialCMDCallback(cmd_uuid,payload) //不进行可重入的判断，下次改进
        }
    })
    /*
     * 事件监听 发现总线上存在MQTT数据事件，则执行相应的代码
     */
    control.onEvent(MQTTEvent, MQTTEventID, function() {
        if(payload_array.length>0){
            let item=payload_array.shift()
            let topic_name=item[0]
            let payload=item[1]
            switch(topic_name){
                case Topic_Data[TOPIC_CLASS.Topic1]:
                    SerialDataCallback[TOPIC_CLASS.Topic1](payload);
                    break;
                case Topic_Data[TOPIC_CLASS.Topic2]:
                    SerialDataCallback[TOPIC_CLASS.Topic2](payload);
                    break;
                case Topic_Data[TOPIC_CLASS.Topic3]:
                    SerialDataCallback[TOPIC_CLASS.Topic3](payload);
                    break;
                case Topic_Data[TOPIC_CLASS.Topic4]:
                    SerialDataCallback[TOPIC_CLASS.Topic4](payload);
                    break;
                case Topic_Data[TOPIC_CLASS.Topic5]:
                    SerialDataCallback[TOPIC_CLASS.Topic5](payload);
                    break;
            }
        }
        
    })
    basic.forever(function() {
        if(esp01_init){
                let fixed_header=serial.readBuffer(1)
                let remaining_length = 0
                let variable_header = null
                let payload = null
                try{
                    switch(fixed_header[0]){
                        case PINGRESP: //Ping 0xD0
                            remaining_length = get_remaining_length();
                            mqtt_ping.flag=true
                            break;
                        case CONNACK: //Connection ACK 0x20
                            remaining_length = get_remaining_length();
                            variable_header = read_serial_bytes(remaining_length); //Return Code
                            mqtt_connect.flag=true
                            mqtt_connect.payload=variable_header[1] //返回结果
                            break;
                        case SUBACK:  // SUBACK  0x90
                            remaining_length = get_remaining_length();
                            variable_header = read_serial_bytes(2); //Packet Identifier
                            payload = read_serial_bytes(1); //Return Code
                            mqtt_sub.flag=true
                            break;
                        case PUBACK:  // PUBACK  0x40
                            remaining_length = get_remaining_length();
                            variable_header = read_serial_bytes(2); //Packet Identifier
                            mqtt_public.flag=true
                            break;
                        case UNSUBACK: //0xB0
                            remaining_length = get_remaining_length();
                            variable_header = read_serial_bytes(remaining_length); //Packet Identifier
                            mqtt_unsub.flag=true
                            break;
                        case PUBLIC1: //0x30 
                        case PUBLIC2: //0x31
                            remaining_length = get_remaining_length();
                            let topic_len = read_serial_a_byte()*256+read_serial_a_byte()
                            let topic_name = read_serial_bytes(topic_len).toString();
                            payload = read_serial_bytes(remaining_length-topic_len-2)
                            run_topic_callback(topic_name,payload.toString());
                            break;
                        default:
                            // 不可识别的固定头信息 ，抛弃到缓冲区内之后的所有数据
                            clean_buff(); //清空缓冲区
                    }
                }catch(e){ //如果有超时，或"剩余长度"过大，抛弃到缓冲区内之后的所有数据
                    clean_buff(); //清空缓冲区
                    basic.showString(e,50) //显示处异常信息
                }
                basic.pause(5)
            }
    }) 
}