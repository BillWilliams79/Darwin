/*CREATE DATABASE IF NOT EXISTS darwin;*/
USE darwin;

/* ############################################## */
/* VERSION 0 Initial tables instatiation */

CREATE TABLE IF NOT EXISTS profiles (
	PRIMARY KEY (id),
    id					INT					NOT NULL AUTO_INCREMENT UNIQUE,
    name	 			VARCHAR(256)		NOT NULL,
    email				VARCHAR(256)		NOT NULL,
    subject				VARCHAR(64)			NOT NULL,
    userName			VARCHAR(256)		NOT NULL,
    region				VARCHAR(128)		NOT NULL,
    userPoolId			VARCHAR(128)		NOT NULL,
    create_ts	        TIMESTAMP 			NULL DEFAULT CURRENT_TIMESTAMP,
    update_ts			TIMESTAMP			NULL ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS domains (
    id 							INT				NOT NULL PRIMARY KEY AUTO_INCREMENT UNIQUE,
    domain_name 				VARCHAR(32)	NOT NULL,
    creator_fk 					INT				NULL,
    create_ts       			TIMESTAMP 		NULL DEFAULT CURRENT_TIMESTAMP,
    update_ts       			TIMESTAMP		NULL ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_fk)
        REFERENCES profiles (id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS areas (
    id							INT				NOT NULL PRIMARY KEY AUTO_INCREMENT UNIQUE,
    area_name 					VARCHAR(32)	NOT NULL,
    domain_fk					INT				NULL,
	creator_fk					INT				NULL,
    create_ts        			TIMESTAMP 		NULL DEFAULT CURRENT_TIMESTAMP,
    update_ts       			TIMESTAMP		NULL ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_fk)
        REFERENCES profiles (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
	FOREIGN KEY (domain_fk)
        REFERENCES domains (id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
    id		 					INT				NOT NULL PRIMARY KEY AUTO_INCREMENT UNIQUE,
    priority					BOOLEAN			NOT NULL,
    done						BOOLEAN			NOT NULL,
    description					VARCHAR(256)	NOT NULL,
    area_fk						INT				NULL,
	creator_fk					INT				NULL,
    create_ts        			TIMESTAMP		NULL DEFAULT CURRENT_TIMESTAMP,
    update_ts       			TIMESTAMP		NULL ON UPDATE CURRENT_TIMESTAMP,
    done_ts     				TIMESTAMP		NULL,
    FOREIGN KEY (creator_fk)
        REFERENCES profiles (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (area_fk)
        REFERENCES areas (id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
/* ######################################################################### */
/* Update #1 to support ability to close (hide) areas from task plan view    */

ALTER TABLE areas
ADD COLUMN closed TINYINT NOT NULL DEFAULT 0;

/* ######################################################################### */
/* Update #2 to support ability to close (hide) domains from task plan view  */
ALTER TABLE domains
ADD COLUMN closed TINYINT NOT NULL DEFAULT 0;

/* ######################################################################### */
/* UPDATE #3 to change profiles primary key from int to VARCHAR(64) in ORDER
             to support Cognito user name                                    */

/* DOMAINS modify dependent tables to drop FK by name first */
ALTER TABLE domains
DROP FOREIGN KEY domains_ibfk_1;

/* AREAS modify dependent tables to drop FK by name first */
ALTER TABLE areas
DROP FOREIGN KEY areas_ibfk_1;

/* TASKS modify dependent tables to drop FK by name first */
ALTER TABLE tasks
DROP FOREIGN KEY tasks_ibfk_1;

/* ########################## */

/* delete one of the duplicate records, id=1 is fine since technically was using id=2 */

DELETE FROM
	profiles
WHERE
	id = 1;

/* After all constrainst referring to the PK area dropped, drop profiles primary key */
ALTER TABLE profiles
DROP COLUMN id;

/* create new id column as primary key, with space for the Cognito user name */
ALTER TABLE profiles
ADD COLUMN id VARCHAR(64) PRIMARY KEY NOT NULL UNIQUE;

/* Set darwintestuser's correct Cognito userId as it's primary key */
UPDATE
	profiles
SET
	id = "3af9d78e-db31-4892-ab42-d1a731b724dd"
WHERE
	email = "darwintestuser@proton.me";

/* ################ */

/* for each table referencing profiles, add a new creator fk, update fk
   with the correct reference and then add the foreign key constraint */
ALTER TABLE domains
MODIFY COLUMN creator_fk VARCHAR(64) NOT NULL;

UPDATE
    domains
SET
    creator_fk = "3af9d78e-db31-4892-ab42-d1a731b724dd";

ALTER TABLE domains 
ADD CONSTRAINT domains_ibfk_1 FOREIGN KEY (creator_fk) REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;


ALTER TABLE areas
MODIFY COLUMN creator_fk VARCHAR(64) NOT NULL;

UPDATE
    areas
SET
    creator_fk = "3af9d78e-db31-4892-ab42-d1a731b724dd";

ALTER TABLE areas 
ADD CONSTRAINT areas_ibfk_1 FOREIGN KEY (creator_fk) REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;


ALTER TABLE tasks
MODIFY COLUMN creator_fk VARCHAR(64) NOT NULL;

UPDATE
    tasks
SET
    creator_fk = "3af9d78e-db31-4892-ab42-d1a731b724dd";

ALTER TABLE tasks 
ADD CONSTRAINT tasks_ibfk_1 FOREIGN KEY (creator_fk) REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;

/* Future Update Here */












/* ########################################################################## */
/* DEBUG AREA: starts with a DESC command that fails so scripts stop here     */
DESC PROFILES79;

select * from profiles;
select * from domains;
select * from areas;
select * from tasks;

select
	*
from
	domains
where
	closed = 1;

UPDATE
	domains
SET
	closed = 0
WHERE
	closed = 1;


/* Display a three table star join to confirm tables and constraints function */
SELECT
	tasks.id,
    priority as 'Priority',
    done as 'Done',
    description as 'Description',
    areas.area_name AS 'Area Name',
    areas.closed AS 'Hide',
    profiles.name AS 'User Name',
    tasks.create_ts AS 'Created',
    tasks.update_ts AS 'Updated',
    tasks.done_ts AS 'Was Done'
FROM
    tasks
        INNER JOIN profiles
			ON tasks.creator_fk = profiles.id
		INNER JOIN areas
			ON tasks.area_fk = areas.id
ORDER BY tasks.id asc;
