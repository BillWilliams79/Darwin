import varDump from '../classifier/classifier';

// make this a rest api call library that has no UI side effects.
// eventually replace with react-router or similar

// Module-level auth token — set by AuthContext, used as fallback when idToken arg omitted
let _authToken = null;
export const setAuthToken = (token) => { _authToken = token; };

const call_rest_api = async (url, method, body, idToken) => {

    //varDump({url, method, body, idToken}, 'call_rest_api parameters');

    // STEP 1 - construct a fetch init object, processing body
    // and incorporating any auth tokens
    const fetchInit = {
        method: method,
        headers: {
          'Content-Type': 'application/json',
        }
    };
    fetchInit['body'] = (body) ? JSON.stringify(body) : null;

    const token = idToken || _authToken;
    if (token) {
        fetchInit['headers']['Authorization'] = token;
    }

    // STEP 2, perform fetch and catch the http status not between 200 and 499
    try {
        //varDump({url, fetchInit}, 'Call Fetch Parameters: call_rest_api');
        var response = await fetch(url, fetchInit)
    } catch (error) {
        const errorReturn = {
            data: {},
            // httpDetail carried here too, even though a transport failure can
            // never be a 409. A second httpStatus shape is exactly the drift
            // that caused req #3049's TypeError-inside-a-catch.
            httpStatus: { httpMethod: fetchInit.method,
                               httpStatus: 503,
                               httpMessage: 'SERVICE UNAVAILABLE',
                               httpDetail: null,},
        };
        return errorReturn;
    };

    // STEP 3 wait for JSON data and parse into javascript
    if (response.status !== 204) {
        // 204 is a No Content response and independent of what is returned from api lambda
        // gives an error retrieving the json data. So skip it!
        try {
            var data = await response.json();
            // Defensive: handle transition period (cached old frontend + new Lambda)
            if (typeof data === 'string' && data.length > 0) {
                try { data = JSON.parse(data); } catch (e) { /* plain string, keep as-is */ }
            }
        } catch (error) {
            varDump(error, 'Error retrieving response.json')
        }
    }

    // STEP 4 construct responseData object and return it
    var httpStatus = {httpMethod: fetchInit.method,
                      httpStatus: response.status,
                      httpMessage: '',
                      httpDetail: null,
    };

    // Generate httpMessage based on HTTP status
    if (response.status === 200) {
        httpStatus.httpMessage = 'OK';
    } else if (response.status === 201) {
        httpStatus.httpMessage = 'CREATED';
    } else if (response.status === 204) {
        httpStatus.httpMessage = 'NO CONTENT';
    } else {
        // there is some form of error, in which case the data returned
        // is actually the error message, unpleasant overload for now
        //
        // A 409 CONFLICT body is a structured object (Lambda-Rest req #3059):
        // {error, errno, constraint, table, message}. Every other error status
        // sends a bare JSON string, and half a dozen callers interpolate
        // httpMessage straight into text — so httpMessage STAYS a string and the
        // object goes on httpDetail. agentRegistryUtils.restErrorMessage is the
        // one consumer that wants the fields.
        if (data && typeof data === 'object') {
            httpStatus.httpDetail = data;
            httpStatus.httpMessage = data.message || JSON.stringify(data);
        } else {
            httpStatus.httpMessage = data;
        }
        data = null;
        // eslint-disable-next-line  no-throw-literal
        throw {data, httpStatus}
    }

    const returnValue = {
        data,
        httpStatus,
    };

    //varDump(returnValue, "Return Fetch Data: call_rest_api");

    return returnValue;
}

export default call_rest_api
